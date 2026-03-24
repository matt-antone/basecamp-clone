create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  archived boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discussion_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body_markdown text not null,
  body_html text not null,
  author_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discussion_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  thread_id uuid not null references discussion_threads(id) on delete cascade,
  body_markdown text not null,
  body_html text not null,
  author_user_id text not null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  uploader_user_id text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  dropbox_file_id text not null,
  dropbox_path text not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'basecamp2',
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_records integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  options jsonb not null default '{}'::jsonb
);

create table if not exists import_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references import_jobs(id) on delete cascade,
  record_type text not null,
  source_record_id text not null,
  status text not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists import_map_projects (
  id uuid primary key default gen_random_uuid(),
  basecamp_project_id text not null unique,
  local_project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists import_map_threads (
  id uuid primary key default gen_random_uuid(),
  basecamp_thread_id text not null unique,
  local_thread_id uuid not null references discussion_threads(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists import_map_comments (
  id uuid primary key default gen_random_uuid(),
  basecamp_comment_id text not null unique,
  local_comment_id uuid not null references discussion_comments(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists import_map_files (
  id uuid primary key default gen_random_uuid(),
  basecamp_file_id text not null unique,
  local_file_id uuid not null references project_files(id) on delete cascade,
  created_at timestamptz not null default now()
);
