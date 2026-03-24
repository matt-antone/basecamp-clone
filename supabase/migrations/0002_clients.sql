create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

alter table projects
  add column if not exists client_id uuid references clients(id) on delete set null;

create index if not exists idx_projects_client_id on projects(client_id);
