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
  /** When matchedBy = "auto-create-pending", this is the prefix to use for the new client (untrimmed-of-internal-ws). */
  autoCreatePrefix?: string;
}

export function resolveTitle(rawTitle: string | null | undefined, knownClients: KnownClient[]): ResolvedTitle {
  void knownClients;
  return {
    clientId: null,
    matchedBy: "none",
    code: null,
    num: null,
    title: String(rawTitle ?? "").trim(),
    confidence: "low"
  };
}
