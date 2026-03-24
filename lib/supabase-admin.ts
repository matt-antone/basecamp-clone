import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

const globalForSupabase = globalThis as unknown as {
  supabaseAdmin?: unknown;
};

export function getSupabaseAdmin() {
  if (globalForSupabase.supabaseAdmin) {
    return globalForSupabase.supabaseAdmin as ReturnType<typeof createClient>;
  }

  const client = createClient(config.supabaseUrl(), config.supabaseServiceRoleKey(), {
    auth: { persistSession: false }
  });

  if (process.env.NODE_ENV !== "production") {
    globalForSupabase.supabaseAdmin = client as unknown;
  }

  return client;
}
