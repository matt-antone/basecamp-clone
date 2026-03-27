// supabase/functions/basecamp-mcp/auth.ts
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AgentIdentity {
  client_id: string;
  role: string;
}

export interface RateLimiter {
  consume(key: string): boolean;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AuthError";
  }
}

export function createRateLimiter(rpmLimit: number): RateLimiter {
  const windows = new Map<string, number[]>();
  return {
    consume(key: string): boolean {
      const now = Date.now();
      const windowMs = 60_000;
      const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
      if (hits.length >= rpmLimit) return false;
      hits.push(now);
      windows.set(key, hits);
      return true;
    },
  };
}

export async function resolveAgent(
  supabase: SupabaseClient,
  clientId: string | null,
  secret: string | null
): Promise<AgentIdentity> {
  if (!clientId || !secret) throw new AuthError("Missing credentials", 401);

  const { data, error } = await supabase
    .from("agent_clients")
    .select("client_id, secret_hash, role, disabled")
    .eq("client_id", clientId)
    .single();

  if (error || !data) throw new AuthError("Unknown agent", 401);
  if (data.disabled) throw new AuthError("Agent disabled", 401);

  const valid = await bcrypt.compare(secret, data.secret_hash);
  if (!valid) throw new AuthError("Invalid secret", 401);

  return { client_id: data.client_id, role: data.role };
}

export async function ensureProfile(
  supabase: SupabaseClient,
  clientId: string
): Promise<void> {
  await supabase
    .from("agent_profiles")
    .upsert({ client_id: clientId }, { onConflict: "client_id", ignoreDuplicates: true });
}
