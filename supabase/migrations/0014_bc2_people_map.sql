-- supabase/migrations/0014_bc2_people_map.sql

-- Map BC2 person IDs to local user_profile IDs
create table if not exists import_map_people (
  id uuid primary key default gen_random_uuid(),
  basecamp_person_id text not null unique,
  local_user_profile_id text not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Flag legacy (dormant) profiles created from BC2 people
alter table user_profiles
  add column if not exists is_legacy boolean not null default false;

-- Index for fast email lookup during Google login reconciliation
create index if not exists idx_user_profiles_legacy_email
  on user_profiles(email) where is_legacy = true;
