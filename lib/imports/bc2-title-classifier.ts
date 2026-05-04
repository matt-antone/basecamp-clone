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

export function classifyTitle(_raw: string | null | undefined): Classification {
  return {
    primaryClass: "empty-raw",
    flags: [],
    code: null,
    num: null,
    parsedTitle: ""
  };
}
