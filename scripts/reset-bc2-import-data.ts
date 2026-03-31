#!/usr/bin/env npx tsx
/**
 * Drops all projects (and cascaded threads, comments, files, maps) plus import job history.
 * Preserves clients, user_profiles, site_settings, import_map_people.
 *
 * Uses TRUNCATE (data only). Does not remove RLS policies, table DDL, grants, or triggers.
 *
 * Usage:
 *   npx tsx scripts/reset-bc2-import-data.ts --yes
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

if (!process.argv.includes("--yes")) {
  console.error("Refusing to run: pass --yes to confirm destructive reset of project data.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (e.g. in .env.local).");
  process.exit(1);
}

const pool = new Pool({ connectionString });

const sql = `
BEGIN;
TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE;
TRUNCATE TABLE projects RESTART IDENTITY CASCADE;
COMMIT;
`;

try {
  await pool.query(sql);
  console.info("Reset complete: projects, discussions, comments, files, import maps/jobs cleared.");
} catch (err: unknown) {
  console.error("Reset failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await pool.end();
}
