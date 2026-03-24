alter table projects
  add column if not exists status text not null default 'new';

update projects
set status = case
  when archived = true then 'complete'
  else 'new'
end
where status is null or status not in ('new', 'in_progress', 'blocked', 'complete');

alter table projects
  drop constraint if exists projects_status_check;

alter table projects
  add constraint projects_status_check
  check (status in ('new', 'in_progress', 'blocked', 'complete'));

create index if not exists idx_projects_status on projects(status);
