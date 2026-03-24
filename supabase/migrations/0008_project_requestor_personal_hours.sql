alter table projects
  add column if not exists requestor text,
  add column if not exists personal_hours numeric;

alter table projects
  drop constraint if exists projects_personal_hours_non_negative;

alter table projects
  add constraint projects_personal_hours_non_negative
  check (personal_hours is null or personal_hours >= 0);
