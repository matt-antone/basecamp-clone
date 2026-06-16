-- Per-user project favorites. Personal (not a global projects column): each
-- (user_id, project_id) row means that user favorited that project.
create table if not exists project_favorites (
  user_id    text not null references user_profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists project_favorites_user_idx on project_favorites(user_id);

-- down (manual / local only — production recovery is restore-from-backup):
--   drop table if exists project_favorites;
