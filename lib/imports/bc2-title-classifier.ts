// lib/imports/bc2-title-classifier.ts

export type PrimaryClass =
  | "empty-raw"
  | "empty-title"
  | "clean"
  | "clean-3digit-num"
  | "suffixed-num"
  | "short-num"
  | "long-num"
  | "missing-colon"
  | "prefix-noise"
  | "fallback-no-num"
  | "no-code";

export type Flag =
  | "lowercase-code"
  | "en-dash-separator"
  | "non-ascii"
  | "leading-trailing-ws"
  | "colon-in-title"
  | "unknown-client-code"
  | "duplicate-code-num";

export interface Classification {
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

// Mirror of parser regexes from lib/imports/bc2-transformer.ts (kept aligned via drift-guard test).
const PRIMARY = /^([A-Za-z]+)-(\d{3,4}):\s*(.*)$/;
const FALLBACK = /^([A-Za-z]+)\s*[-–]\s*(.+)$/;

const SUFFIXED_NUM = /^([A-Za-z]+)-(\d+[A-Za-z]+)(?::\s*(.*)|\s+(.+))?$/;
const SHORT_NUM = /^([A-Za-z]+)-(\d{1,2})(?::\s*(.*)|\s+(.+))?$/;
const LONG_NUM = /^([A-Za-z]+)-(\d{5,})(?::\s*(.*)|\s+(.+))?$/;
const MISSING_COLON = /^([A-Za-z]+)-(\d{3,4})\s+(\S.*)$/;
// Code-num appears, but NOT at position 0. We assert "not start-anchored" outside the regex.
const ANYWHERE_CODE_NUM = /\b([A-Za-z]+)-(\d{3,4})(?::\s*(.*)|\s+(.+))?$/;
const STARTS_WITH_CODE_NUM = /^[A-Za-z]+-\d{3,4}/;

export function classifyTitle(raw: string | null | undefined): Classification {
  if (raw == null || String(raw).trim() === "") {
    return { primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" };
  }

  const trimmed = String(raw).trim();

  // PRIMARY (clean / clean-3digit-num / empty-title)
  const primary = trimmed.match(PRIMARY);
  if (primary) {
    const [, code, num, title] = primary;
    const titleTrim = title.trim();
    if (titleTrim === "") {
      return { primaryClass: "empty-title", flags: [], code, num, parsedTitle: "" };
    }
    const cls: PrimaryClass = num.length === 4 ? "clean" : "clean-3digit-num";
    return { primaryClass: cls, flags: [], code, num, parsedTitle: titleTrim };
  }

  // suffixed-num — `CODE-NNNNx[: rest]`
  const suffixed = trimmed.match(SUFFIXED_NUM);
  if (suffixed) {
    const [, code, num, t1, t2] = suffixed;
    return { primaryClass: "suffixed-num", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
  }

  // short-num — `CODE-N` or `CODE-NN`
  const short = trimmed.match(SHORT_NUM);
  if (short) {
    const [, code, num, t1, t2] = short;
    return { primaryClass: "short-num", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
  }

  // long-num — `CODE-NNNNN+`
  const long = trimmed.match(LONG_NUM);
  if (long) {
    const [, code, num, t1, t2] = long;
    return { primaryClass: "long-num", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
  }

  // missing-colon — `CODE-NNN <title>` (no colon)
  const missing = trimmed.match(MISSING_COLON);
  if (missing) {
    const [, code, num, title] = missing;
    return { primaryClass: "missing-colon", flags: [], code, num, parsedTitle: title.trim() };
  }

  // prefix-noise — code-num appears, but NOT at start
  if (!STARTS_WITH_CODE_NUM.test(trimmed)) {
    const noise = trimmed.match(ANYWHERE_CODE_NUM);
    if (noise) {
      const [, code, num, t1, t2] = noise;
      return { primaryClass: "prefix-noise", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
    }
  }

  // fallback-no-num — `CODE - title` with no digits
  const fb = trimmed.match(FALLBACK);
  if (fb) {
    const [, code, title] = fb;
    return { primaryClass: "fallback-no-num", flags: [], code, num: null, parsedTitle: title.trim() };
  }

  // no-code — catch-all
  return { primaryClass: "no-code", flags: [], code: null, num: null, parsedTitle: trimmed };
}
