-- 0026_project_members.sql
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id text not null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_members_user_id on project_members(user_id);

alter table discussion_threads add column if not exists edited_at timestamptz;

-- Backfill: seed project_members from existing activity.
-- Scoped to active projects only (projects.archived = false and clients.archived_at is null)
-- to avoid populating member lists for projects that are no longer in use.
-- Safe to re-run: ON CONFLICT DO NOTHING.
with active_projects as (
  select p.id, p.created_by
  from projects p
  join clients c on c.id = p.client_id
  where p.archived = false and c.archived_at is null
)
insert into project_members (project_id, user_id)
select id, created_by from active_projects
union
select t.project_id, t.author_user_id
  from discussion_threads t
  join active_projects ap on ap.id = t.project_id
union
select t.project_id, c.author_user_id
  from discussion_comments c
  join discussion_threads t on t.id = c.thread_id
  join active_projects ap on ap.id = t.project_id
on conflict do nothing;
