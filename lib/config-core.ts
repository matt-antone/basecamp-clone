/**
 * Runtime-agnostic config core.
 * Works in both Node.js (Next.js) and Deno (Supabase Edge Functions).
 * Next.js entry point re-exports this with "server-only" guard via lib/config.ts.
 */

const supabaseUrlKeys = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const supabaseAnonKeyKeys = ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const siteUrlKeys = ["NEXT_PUBLIC_SITE_URL", "URL"] as const;

type RequiredKey = "DATABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "WORKSPACE_DOMAIN";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _Deno = typeof globalThis !== "undefined" ? (globalThis as any).Deno : undefined;

function readEnv(key: string): string | undefined {
  if (_Deno) return _Deno.env.get(key);
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

function getEnv(key: RequiredKey): string {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function getOptionalEnv(key: string): string | null {
  const value = readEnv(key);
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getFirstEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = getOptionalEnv(key);
    if (value) {
      return value;
    }
  }

  return null;
}

function getSupabaseUrl(): string {
  const value = getFirstEnv(supabaseUrlKeys);
  if (!value) {
    throw new Error("Missing required env var: SUPABASE_URL");
  }
  return value;
}

function getSupabaseAnonKey(): string {
  const value = getFirstEnv(supabaseAnonKeyKeys);
  if (!value) {
    throw new Error("Missing required env var: SUPABASE_ANON_KEY");
  }
  return value;
}

function normalizeOriginUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `https://${value}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

export function normalizeThumbnailWorkerUrl(value: string | null, source = "THUMBNAIL_WORKER_URL") {
  if (!value) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error(`${source} must be a valid origin, for example https://thumbs.example.internal`);
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath || parsed.search || parsed.hash) {
    throw new Error(
      `${source} must be origin-only, for example https://thumbs.example.internal. Remove any path such as /thumbnails.`
    );
  }

  return parsed.origin;
}

function getBooleanEnv(key: string, fallback: boolean): boolean {
  const value = getOptionalEnv(key);
  if (!value) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function getNumberEnv(key: string, fallback: number): number {
  const value = getOptionalEnv(key);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var: ${key}`);
  }

  return parsed;
}

export const config = {
  databaseUrl: () => getEnv("DATABASE_URL"),
  supabaseUrl: getSupabaseUrl,
  supabaseAnonKey: getSupabaseAnonKey,
  supabaseServiceRoleKey: () => getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  workspaceDomain: () => getEnv("WORKSPACE_DOMAIN").toLowerCase(),
  siteUrl: () => normalizeOriginUrl(getFirstEnv(siteUrlKeys)),
  dropboxAppKey: () => getOptionalEnv("DROPBOX_APP_KEY"),
  dropboxAppSecret: () => getOptionalEnv("DROPBOX_APP_SECRET"),
  dropboxRefreshToken: () => getOptionalEnv("DROPBOX_REFRESH_TOKEN"),
  dropboxSelectUser: () => getOptionalEnv("DROPBOX_SELECT_USER"),
  dropboxSelectAdmin: () => getOptionalEnv("DROPBOX_SELECT_ADMIN"),
  dropboxProjectsRootFolder: () =>
    getOptionalEnv("DROPBOX_PROJECTS_ROOT_FOLDER") ??
    getOptionalEnv("DROPBOX_ROOT_FOLDER") ??
    "/Projects",
  dropboxArchivedClientsRoot: () => {
    const value = getOptionalEnv("DROPBOX_ARCHIVED_CLIENTS_ROOT");
    if (!value) {
      throw new Error("DROPBOX_ARCHIVED_CLIENTS_ROOT is required to archive clients.");
    }
    return value;
  },
  blobReadWriteToken: () => {
    const value = process.env.BLOB_READ_WRITE_TOKEN;
    if (!value) {
      throw new Error("BLOB_READ_WRITE_TOKEN is required for file uploads");
    }
    return value;
  },
  thumbnailWorkerUrl: () => normalizeThumbnailWorkerUrl(getOptionalEnv("THUMBNAIL_WORKER_URL")),
  thumbnailWorkerToken: () => getOptionalEnv("THUMBNAIL_WORKER_TOKEN"),
  thumbnailWorkerTimeoutMs: () => getNumberEnv("THUMBNAIL_WORKER_TIMEOUT_MS", 15000),
  emailEnabled: () => getBooleanEnv("EMAIL_ENABLED", true),
  emailFrom: () => {
    const value = getOptionalEnv("EMAIL_FROM") ?? getOptionalEnv("MAILGUN_EMAIL");
    if (!value) {
      throw new Error("Missing required env var: EMAIL_FROM or MAILGUN_EMAIL");
    }
    return value;
  },
  mailgunApiKey: () => {
    const value = getOptionalEnv("MAILGUN_API_KEY");
    if (!value) {
      throw new Error("Missing required env var: MAILGUN_API_KEY");
    }
    return value;
  },
  mailgunDomain: () => {
    const value = getOptionalEnv("MAILGUN_DOMAIN");
    if (!value) {
      throw new Error("Missing required env var: MAILGUN_DOMAIN");
    }
    return value;
  },
  mailgunBaseUrl: () => getOptionalEnv("MAILGUN_BASE_URL") ?? "https://api.mailgun.net"
};
