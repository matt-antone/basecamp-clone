create table if not exists thumbnail_jobs (
  id uuid primary key default gen_random_uuid(),
  project_file_id uuid not null unique references project_files(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists thumbnail_jobs_status_next_attempt_idx
  on thumbnail_jobs (status, next_attempt_at);
