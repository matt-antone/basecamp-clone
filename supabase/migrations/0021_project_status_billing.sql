alter table projects
  drop constraint if exists projects_status_check;

alter table projects
  add constraint projects_status_check
  check (status in ('new', 'in_progress', 'blocked', 'complete', 'billing'));
