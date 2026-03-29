// lib/imports/bc2-transformer.ts
import { query } from "../db";

export interface ParsedProjectTitle {
  code: string | null;
  num: string | null;
  title: string;
}

const PRIMARY_PATTERN = /^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/;
const FALLBACK_PATTERN = /^([A-Za-z]+)\s*[-\u2013]\s*(.+)$/;

export function parseProjectTitle(raw: string): ParsedProjectTitle {
  const primaryMatch = raw.match(PRIMARY_PATTERN);
  if (primaryMatch) {
    return {
      code: primaryMatch[1],
      num: primaryMatch[2],
      title: primaryMatch[3].trim()
    };
  }

  const fallbackMatch = raw.match(FALLBACK_PATTERN);
  if (fallbackMatch) {
    return {
      code: fallbackMatch[1],
      num: null,
      title: fallbackMatch[2].trim()
    };
  }

  return { code: null, num: null, title: raw.trim() };
}

// Look up a client by code (case-insensitive) or create one.
// Returns the client id (uuid).
export async function resolveClientId(code: string): Promise<string> {
  const existing = await query(
    "select id from clients where lower(code) = lower($1) limit 1",
    [code]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id as string;
  }

  const created = await query(
    "insert into clients (name, code) values ($1, $2) returning id",
    [code, code]
  );
  return created.rows[0].id as string;
}
