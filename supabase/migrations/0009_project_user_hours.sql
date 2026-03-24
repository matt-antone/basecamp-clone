create table if not exists project_user_hours (
  project_id uuid not null references projects(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  hours numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_user_hours_hours_non_negative check (hours >= 0)
);

create index if not exists idx_project_user_hours_user_id on project_user_hours(user_id);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'personal_hours'
  ) then
    execute $migration$
      insert into project_user_hours (project_id, user_id, hours)
      select projects.id, projects.created_by, projects.personal_hours
      from projects
      inner join user_profiles on user_profiles.id = projects.created_by
      where projects.personal_hours is not null
      on conflict (project_id, user_id) do update
      set hours = excluded.hours,
          updated_at = now()
    $migration$;
  end if;
end $$;

alter table projects
  drop constraint if exists projects_personal_hours_non_negative;

alter table projects
  drop column if exists personal_hours;
