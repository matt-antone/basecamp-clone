#!/usr/bin/env node
/**
 * MCP stdio-to-HTTP proxy with per-request JWT minting.
 * Used by Claude Code (stdio transport) to connect to the basecamp-mcp edge function.
 *
 * Required env vars:
 *   PM_CLIENT_MCP_URL       — edge function URL
 *   PM_CLIENT_JWT_SECRET    — HMAC-SHA256 signing secret (matches PM_SERVER_JWT_SECRET)
 *   PM_CLIENT_ID            — client_id registered in agent_clients
 *   PM_CLIENT_JWT_ISSUER    — JWT iss claim (default: "basecamp-mcp")
 *   PM_CLIENT_JWT_AUDIENCE  — JWT aud claim (default: "basecamp-mcp")
 */

import { randomUUID, createHmac } from "node:crypto";
import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(file) {
  if (!file || !existsSync(file)) return {};
  const env = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    }
    env[match[1]] = value;
  }
  return env;
}

const home = process.env.HOME ?? "";
const fileEnv = parseEnvFile(join(home, ".claude", ".env.local"));

function env(key) {
  return process.env[key] ?? fileEnv[key] ?? "";
}

const url = env("PM_CLIENT_MCP_URL");
const secret = env("PM_CLIENT_JWT_SECRET");
const clientId = env("PM_CLIENT_ID");
const issuer = env("PM_CLIENT_JWT_ISSUER") || "basecamp-mcp";
const audience = env("PM_CLIENT_JWT_AUDIENCE") || "basecamp-mcp";

if (!url || !secret || !clientId) {
  process.stderr.write(
    "mcp-stdio-proxy: missing PM_CLIENT_MCP_URL, PM_CLIENT_JWT_SECRET, or PM_CLIENT_ID\n"
  );
  process.exit(1);
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function mintJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: clientId,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 15 * 60,
    jti: randomUUID(),
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

function parseRpcResponse(text, contentType) {
  if (contentType?.includes("text/event-stream") || text.includes("\ndata:") || text.includes("event:")) {
    const parts = text.split(/\n\n+/);
    for (const part of parts) {
      const dataLine = part
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine);
        if (parsed?.result !== undefined || parsed?.error !== undefined || parsed?.method !== undefined) {
          return dataLine;
        }
      } catch {
        // skip malformed chunks
      }
    }
    return null;
  }
  return text.trim() || null;
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return; // ignore non-JSON
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${mintJwt()}`,
      },
      body: JSON.stringify(message),
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      const errResponse = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32603, message: `HTTP ${res.status}: ${text.trim()}` },
      });
      process.stdout.write(errResponse + "\n");
      return;
    }

    const output = parseRpcResponse(text, contentType);
    if (output) {
      process.stdout.write(output + "\n");
    }
  } catch (err) {
    const errResponse = JSON.stringify({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32603, message: String(err.message) },
    });
    process.stdout.write(errResponse + "\n");
  }
});
