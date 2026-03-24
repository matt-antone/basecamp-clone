alter table projects
  add column if not exists project_seq integer,
  add column if not exists project_code text,
  add column if not exists client_slug text,
  add column if not exists project_slug text,
  add column if not exists storage_project_dir text;

with ranked as (
  select
    p.id,
    p.name,
    p.client_id,
    coalesce(c.code, 'GEN') as client_code,
    coalesce(c.name, 'unassigned') as client_name,
    row_number() over (partition by p.client_id order by p.created_at, p.id) as seq
  from projects p
  left join clients c on c.id = p.client_id
), normalized as (
  select
    id,
    seq,
    client_code,
    trim(both '-' from regexp_replace(lower(client_name), '[^a-z0-9]+', '-', 'g')) as raw_client_slug,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) as raw_project_slug
  from ranked
)
update projects p
set
  project_seq = n.seq,
  project_code = n.client_code || '-' || lpad(n.seq::text, 4, '0'),
  client_slug = case when n.raw_client_slug = '' then 'unassigned' else n.raw_client_slug end,
  project_slug = case when n.raw_project_slug = '' then 'project' else n.raw_project_slug end,
  storage_project_dir = '/projects/' ||
    (case when n.raw_client_slug = '' then 'unassigned' else n.raw_client_slug end) || '/' ||
    (n.client_code || '-' || lpad(n.seq::text, 4, '0')) || '-' ||
    (case when n.raw_project_slug = '' then 'project' else n.raw_project_slug end)
from normalized n
where p.id = n.id
  and (
    p.project_seq is null
    or p.project_code is null
    or p.client_slug is null
    or p.project_slug is null
    or p.storage_project_dir is null
  );

alter table projects
  alter column project_seq set not null,
  alter column project_code set not null,
  alter column client_slug set not null,
  alter column project_slug set not null,
  alter column storage_project_dir set not null;

create unique index if not exists idx_projects_project_code_unique on projects(project_code);
create unique index if not exists idx_projects_client_seq_unique
  on projects((coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)), project_seq);

create index if not exists idx_projects_storage_project_dir on projects(storage_project_dir);
