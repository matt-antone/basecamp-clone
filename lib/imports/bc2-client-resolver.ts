// lib/imports/bc2-client-resolver.ts
import { parseProjectTitle } from "./bc2-transformer";

export interface KnownClient {
  id: string;
  code: string;
  name: string;
}

export type MatchedBy = "code" | "name" | "auto-create-pending" | "none";
export type Confidence = "high" | "medium" | "low";

export interface ResolvedTitle {
  clientId: string | null;
  matchedBy: MatchedBy;
  code: string | null;
  num: string | null;
  title: string;
  confidence: Confidence;
  autoCreatePrefix?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.]/g, "");
}

interface NormEntry {
  norm: string;
  client: KnownClient;
  source: "code" | "name";
}

function buildIndex(clients: KnownClient[]): NormEntry[] {
  // Dedupe by norm key, preferring source="code" over "name" so a client whose
  // own code matches the norm wins over other clients sharing that name.
  const byNorm = new Map<string, NormEntry>();
  for (const c of clients) {
    const codeNorm = normalize(c.code);
    if (codeNorm) {
      const existing = byNorm.get(codeNorm);
      if (!existing || existing.source !== "code") {
        byNorm.set(codeNorm, { norm: codeNorm, client: c, source: "code" });
      }
    }
    const nameNorm = normalize(c.name);
    if (nameNorm && nameNorm !== codeNorm) {
      const existing = byNorm.get(nameNorm);
      if (!existing) {
        byNorm.set(nameNorm, { norm: nameNorm, client: c, source: "name" });
      }
    }
  }
  const entries = Array.from(byNorm.values());
  // Longest first for greedy prefix match.
  entries.sort((a, b) => b.norm.length - a.norm.length);
  return entries;
}

/**
 * Find the longest prefix of normLead that equals an indexed key.
 * Returns the matched entry or null.
 */
function longestPrefixMatch(normLead: string, index: NormEntry[]): NormEntry | null {
  for (const e of index) {
    if (normLead === e.norm || normLead.startsWith(e.norm)) {
      return e;
    }
  }
  return null;
}

/**
 * Given the original (untrimmed-of-internal-ws) trimmed title and a matched normalized key,
 * find where the matched prefix ends in the original string.
 * Returns the substring AFTER the matched prefix.
 *
 * Approach: walk character by character through the original trimmed string,
 * accumulating a normalized buffer. When the buffer equals the matched key,
 * that index is the end of the matched prefix.
 */
function stripMatchedPrefix(original: string, matchedKey: string): string {
  let buffer = "";
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    const chLower = ch.toLowerCase();
    if (!/[\s\-_.]/.test(ch)) {
      buffer += chLower;
    }
    if (buffer === matchedKey) {
      return original.slice(i + 1);
    }
  }
  return "";
}

const REMAINDER_NUM_TITLE = /^(\d+[A-Za-z]*)\s*[:\s]\s*(.+)$/;

export function resolveTitle(rawTitle: string | null | undefined, knownClients: KnownClient[]): ResolvedTitle {
  const trimmed = String(rawTitle ?? "").trim();
  if (trimmed === "") {
    return { clientId: null, matchedBy: "none", code: null, num: null, title: "", confidence: "low" };
  }

  const index = buildIndex(knownClients);

  // ── Step 1: Parser-first path. PRIMARY hit means clean code+num.
  const parsed = parseProjectTitle(trimmed);
  if (parsed.code && parsed.num) {
    const codeNorm = normalize(parsed.code);
    const matched = index.find((e) => e.norm === codeNorm);
    if (matched) {
      return {
        clientId: matched.client.id,
        matchedBy: "code",
        code: matched.client.code,
        num: parsed.num,
        title: parsed.title,
        confidence: "high"
      };
    }
    // Clean parse, unknown client. Auto-create candidate (gated to prefix length >= 3).
    if (parsed.code.length >= 3) {
      return {
        clientId: null,
        matchedBy: "auto-create-pending",
        code: parsed.code,
        num: parsed.num,
        title: parsed.title,
        confidence: "medium",
        autoCreatePrefix: parsed.code
      };
    }
    // Sub-3 unknown code: fall through to remaining steps.
  }

  // ── Step 2: Compound-prefix lookup against the normalized lead.
  // Take the lead as everything up to the first ":" or first whitespace before digits.
  // Simpler: build a candidate lead by progressively normalizing characters and seeing
  // if the normalized buffer matches any indexed key — handled inside stripMatchedPrefix.
  const normFull = normalize(trimmed);
  const matched = longestPrefixMatch(normFull, index);
  if (matched) {
    const remainderRaw = stripMatchedPrefix(trimmed, matched.norm);
    // Strip leading separators (`-`, ` `, `:`).
    const remainder = remainderRaw.replace(/^[\s\-:]+/, "");
    const numMatch = remainder.match(REMAINDER_NUM_TITLE);
    if (numMatch) {
      return {
        clientId: matched.client.id,
        matchedBy: "code",
        code: matched.client.code,
        num: numMatch[1],
        title: numMatch[2].trim(),
        confidence: "high"
      };
    }
    // No num in remainder: matched by name with no project number.
    return {
      clientId: matched.client.id,
      matchedBy: "name",
      code: matched.client.code,
      num: null,
      title: remainder.trim(),
      confidence: "medium"
    };
  }

  // ── Step 3: No compound match. If parser caught a code (FALLBACK path, no num),
  // treat as auto-create-pending so caller can decide whether to materialize a new client.
  if (parsed.code && parsed.code.length >= 3) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: parsed.code,
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: parsed.code
    };
  }

  // ── Step 4: Multi-word prefix where parser couldn't extract a code but the title
  // has a `-\d` marker (e.g. "Merrill Lynch-001: ..."). Take the leading letter-word
  // as the auto-create candidate.
  const leadWordMatch = trimmed.match(/^([A-Za-z]+)\b/);
  const hasNumMarker = /-\d{1,5}[A-Za-z]*/.test(trimmed);
  if (leadWordMatch && hasNumMarker && leadWordMatch[1].length >= 3) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: leadWordMatch[1],
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: leadWordMatch[1]
    };
  }

  // Total miss: no code, no compound. Skip+flag.
  return {
    clientId: null,
    matchedBy: "none",
    code: null,
    num: null,
    title: trimmed,
    confidence: "low"
  };
}
