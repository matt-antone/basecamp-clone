import { afterEach, describe, expect, it } from "vitest";
import { createServerSupabaseAuthClient } from "@/lib/server-auth";

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const originalNextPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalNextPublicSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  if (typeof originalSupabaseUrl === "string") {
    process.env.SUPABASE_URL = originalSupabaseUrl;
  } else {
    delete process.env.SUPABASE_URL;
  }

  if (typeof originalSupabaseAnonKey === "string") {
    process.env.SUPABASE_ANON_KEY = originalSupabaseAnonKey;
  } else {
    delete process.env.SUPABASE_ANON_KEY;
  }

  if (typeof originalNextPublicSupabaseUrl === "string") {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalNextPublicSupabaseUrl;
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  if (typeof originalNextPublicSupabaseAnonKey === "string") {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalNextPublicSupabaseAnonKey;
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
});

describe("server auth PKCE storage", () => {
  it("captures the PKCE verifier in custom storage during OAuth start", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";

    const { client, readPkceStorage } = createServerSupabaseAuthClient();
    const result = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://app.example.com/auth/google/callback",
        skipBrowserRedirect: true
      }
    });

    expect(result.error).toBeNull();
    expect(Object.keys(readPkceStorage())).toContain("sb-example-auth-token-code-verifier");
  });
});
