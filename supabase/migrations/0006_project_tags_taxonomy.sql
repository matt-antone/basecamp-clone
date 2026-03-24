alter table projects
  add column if not exists tags text[] not null default '{}'::text[];

-- Normalize existing data if any null/blank tags slipped in.
update projects
set tags = (
  select coalesce(array_agg(distinct lower(trim(t.tag))), '{}'::text[])
  from unnest(coalesce(projects.tags, '{}'::text[])) as t(tag)
  where trim(t.tag) <> ''
)
where exists (
  select 1
  from unnest(coalesce(projects.tags, '{}'::text[])) as t(tag)
  where t.tag is null
     or trim(t.tag) = ''
     or t.tag <> lower(trim(t.tag))
);

alter table projects
  drop constraint if exists projects_tags_no_blank;

create or replace function public.project_tags_are_valid(input_tags text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(btrim(tag) <> ''), true)
  from unnest(input_tags) as tag
$$;

alter table projects
  add constraint projects_tags_no_blank
  check (public.project_tags_are_valid(tags));

create index if not exists idx_projects_tags_gin on projects using gin (tags);
