-- Reset project/discussion/comment/file data and BC2 import bookkeeping for a clean re-import.
--
-- RLS / schema safety: TRUNCATE only deletes rows. It does not drop or alter Row Level Security
-- policies, RLS enablement on tables, triggers, indexes, or GRANTs. Supabase/dashboard policies
-- remain intact on empty tables.
--
-- PRESERVES: clients, user_profiles, site_settings, import_map_people, agent_*.
-- REMOVES: projects (CASCADE: threads, comments, files, thumbnail_jobs, project_user_hours,
--          import_map_projects/threads/comments/files), import_jobs (CASCADE: import_logs).
--
-- Run in Supabase SQL Editor, or:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-bc2-import-data.sql

BEGIN;

-- Import audit trail (import_logs FK → import_jobs)
TRUNCATE TABLE import_jobs RESTART IDENTITY CASCADE;

-- All project-scoped rows and BC2 id maps that reference them
TRUNCATE TABLE projects RESTART IDENTITY CASCADE;

COMMIT;
