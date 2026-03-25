import "server-only";

import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { config } from "./config";

export const ACCESS_TOKEN_COOKIE = "bc_access_token";
export const REFRESH_TOKEN_COOKIE = "bc_refresh_token";
const PKCE_STORAGE_COOKIE = "bc_pkce_storage";

type PkceStorageSnapshot = Record<string, string>;

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(typeof maxAge === "number" ? { maxAge } : {})
  };
}

function firstHeaderValue(value: string | null) {
  if (!value) {
    return null;
  }

  const first = value
    .split(",")[0]
    ?.trim();

  return first || null;
}

function normalizeProto(value: string | null, fallback: string) {
  const normalized = firstHeaderValue(value)?.replace(/:$/, "").toLowerCase();
  return normalized === "http" || normalized === "https" ? normalized : fallback;
}

function originFromHeaders(request: NextRequest) {
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    firstHeaderValue(request.headers.get("host"));

  if (!host) {
    return null;
  }

  const fallbackProtocol = request.nextUrl.protocol.replace(/:$/, "") || "https";
  const proto = normalizeProto(request.headers.get("x-forwarded-proto"), fallbackProtocol);
  return `${proto}://${host}`;
}

function createMemoryStorage(initial: PkceStorageSnapshot = {}) {
  const values = { ...initial };

  return {
    storage: {
      getItem(key: string) {
        return values[key] ?? null;
      },
      setItem(key: string, value: string) {
        values[key] = value;
      },
      removeItem(key: string) {
        delete values[key];
      }
    },
    snapshot() {
      return { ...values };
    }
  };
}

function parsePkceStorage(raw: string | undefined): PkceStorageSnapshot {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

export function createServerSupabaseAuthClient(initialPkceStorage: PkceStorageSnapshot = {}) {
  const memoryStorage = createMemoryStorage(initialPkceStorage);

  const client = createClient(config.supabaseUrl(), config.supabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      // Supabase only honors a custom auth storage adapter when persistSession is enabled.
      // We still keep the storage request-scoped via createMemoryStorage, but this allows
      // the PKCE code verifier to survive the /start -> /callback roundtrip in our cookie.
      persistSession: true,
      storage: memoryStorage.storage
    }
  });

  return {
    client,
    readPkceStorage: memoryStorage.snapshot
  };
}

export function getPkceStorageFromRequest(request: NextRequest) {
  return parsePkceStorage(request.cookies.get(PKCE_STORAGE_COOKIE)?.value);
}

export function setPkceStorageCookie(response: NextResponse, storage: PkceStorageSnapshot) {
  const keys = Object.keys(storage);
  if (!keys.length) {
    response.cookies.delete(PKCE_STORAGE_COOKIE);
    return;
  }

  response.cookies.set(PKCE_STORAGE_COOKIE, JSON.stringify(storage), cookieOptions(60 * 10));
}

export function clearPkceStorageCookie(response: NextResponse) {
  response.cookies.delete(PKCE_STORAGE_COOKIE);
}

export function setAuthSessionCookies(response: NextResponse, session: Session) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token, cookieOptions(session.expires_in ?? 60 * 60));
  response.cookies.set(REFRESH_TOKEN_COOKIE, session.refresh_token, cookieOptions(60 * 60 * 24 * 30));
}

export function clearAuthSessionCookies(response: NextResponse) {
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  response.cookies.delete(PKCE_STORAGE_COOKIE);
}

function requestOrigin(request: NextRequest) {
  const configured = config.siteUrl();
  if (configured) {
    return configured;
  }

  const headerOrigin = originFromHeaders(request);
  if (headerOrigin) {
    return headerOrigin;
  }

  return new URL(request.url).origin;
}

export function buildGoogleCallbackUrl(request: NextRequest) {
  return `${requestOrigin(request)}/auth/google/callback`;
}

export function buildAppRedirectUrl(request: NextRequest, path = "/") {
  return new URL(path, requestOrigin(request));
}

export function authSessionPayload(args: {
  accessToken: string | null;
  domainAllowed: boolean;
  status: string;
  user: User | null;
}) {
  const metadata =
    args.user?.user_metadata && typeof args.user.user_metadata === "object"
      ? (args.user.user_metadata as Record<string, unknown>)
      : {};

  return {
    accessToken: args.accessToken,
    domainAllowed: args.domainAllowed,
    googleAvatarUrl: typeof metadata.avatar_url === "string" ? metadata.avatar_url : "",
    status: args.status,
    user: args.user
      ? {
          id: args.user.id,
          email: args.user.email ?? undefined
        }
      : null
  };
}
