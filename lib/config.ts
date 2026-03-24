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

export const config = {
  databaseUrl: () => getEnv("DATABASE_URL"),
  supabaseUrl: getSupabaseUrl,
  supabaseServiceRoleKey: () => getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  workspaceDomain: () => getEnv("WORKSPACE_DOMAIN").toLowerCase(),
  dropboxProjectsRootFolder: () => process.env.DROPBOX_PROJECTS_ROOT_FOLDER ?? "/projects"
};
