-- supabase/migrations/0016_project_last_activity_at.sql

alter table projects
  add column if not exists last_activity_at timestamptz;

-- Backfill: set last_activity_at to the same greatest() value the archive query computed
update projects p
set last_activity_at = greatest(
  p.updated_at,
  coalesce((select max(t.updated_at) from discussion_threads t where t.project_id = p.id), p.updated_at),
  coalesce((select max(dc.updated_at) from discussion_comments dc where dc.project_id = p.id), p.updated_at),
  coalesce((select max(f.created_at) from project_files f where f.project_id = p.id), p.updated_at)
);

-- Default going forward: use updated_at for any rows not yet touched by a write
alter table projects
  alter column last_activity_at set default now();

-- Index to make the archive ORDER BY last_activity_at DESC efficient
create index if not exists idx_projects_archived_activity
  on projects (archived, last_activity_at desc);
