create table if not exists user_profiles (
  id text primary key,
  email text not null,
  first_name text,
  last_name text,
  avatar_url text,
  job_title text,
  timezone text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_email on user_profiles(email);
