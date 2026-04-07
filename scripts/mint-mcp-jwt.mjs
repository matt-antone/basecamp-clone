#!/usr/bin/env node
import { randomUUID, createHmac } from "node:crypto";

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function mintJwt({ secret, issuer, audience, clientId, role, scope, expiresInSeconds, tokenVersion, authEpoch }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: clientId,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + expiresInSeconds,
    jti: randomUUID(),
    ...(role ? { role } : {}),
    ...(scope ? { scope } : {}),
    ...(tokenVersion !== undefined ? { token_version: tokenVersion } : {}),
    ...(authEpoch !== undefined ? { auth_epoch: authEpoch } : {}),
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

const args = parseArgs(process.argv);
const secret = args.secret ?? process.env.MCP_JWT_SECRET;
const issuer = args.issuer ?? process.env.MCP_JWT_ISSUER ?? "basecamp-mcp";
const audience = args.audience ?? process.env.MCP_JWT_AUDIENCE ?? "basecamp-mcp";
const clientId = args["client-id"] ?? args.clientId ?? process.env.MCP_CLIENT_ID;
const role = args.role ?? process.env.MCP_JWT_ROLE;
const scope = args.scope ?? process.env.MCP_JWT_SCOPE;
const expiresInSeconds = Number(args["expires-in"] ?? process.env.MCP_JWT_EXPIRES_IN ?? 900);
const tokenVersion = args["token-version"] !== undefined ? Number(args["token-version"]) : undefined;
const authEpoch = args["auth-epoch"] !== undefined ? Number(args["auth-epoch"]) : undefined;

if (!secret) {
  console.error("Missing secret. Pass --secret or set MCP_JWT_SECRET.");
  process.exit(1);
}
if (!clientId) {
  console.error("Missing client id. Pass --client-id or set MCP_CLIENT_ID.");
  process.exit(1);
}

const token = mintJwt({
  secret,
  issuer,
  audience,
  clientId,
  role,
  scope,
  expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : 900,
  tokenVersion: Number.isFinite(tokenVersion) ? tokenVersion : undefined,
  authEpoch: Number.isFinite(authEpoch) ? authEpoch : undefined,
});

process.stdout.write(`${token}\n`);
