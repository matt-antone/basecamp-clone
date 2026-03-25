const required = ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKSPACE_DOMAIN"] as const;

type RequiredKey = (typeof required)[number];

function getEnv(key: RequiredKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!value) {
    throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

function getOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  supabaseServiceRoleKey: () => getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  workspaceDomain: () => getEnv("WORKSPACE_DOMAIN").toLowerCase(),
  dropboxProjectsRootFolder: () => process.env.DROPBOX_PROJECTS_ROOT_FOLDER ?? "/projects",
  emailEnabled: () => getBooleanEnv("EMAIL_ENABLED", true),
  emailFrom: () => {
    const value = getOptionalEnv("EMAIL_FROM");
    if (!value) {
      throw new Error("Missing required env var: EMAIL_FROM");
    }
    return value;
  },
  smtpHost: () => getOptionalEnv("SMTP_HOST") ?? "smtp-relay.gmail.com",
  smtpPort: () => getNumberEnv("SMTP_PORT", 587),
  smtpSecure: () => getBooleanEnv("SMTP_SECURE", false),
  smtpUsername: () => getOptionalEnv("SMTP_USERNAME"),
  smtpPassword: () => getOptionalEnv("SMTP_PASSWORD")
};
