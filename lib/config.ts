const required = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WORKSPACE_DOMAIN"
] as const;

type RequiredKey = (typeof required)[number];

function getEnv(key: RequiredKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const config = {
  databaseUrl: () => getEnv("DATABASE_URL"),
  supabaseUrl: () => getEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: () => getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  workspaceDomain: () => getEnv("WORKSPACE_DOMAIN").toLowerCase(),
  dropboxProjectsRootFolder: () => process.env.DROPBOX_PROJECTS_ROOT_FOLDER ?? "/projects"
};
