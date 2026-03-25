create table if not exists site_settings (
  id text primary key default 'default',
  site_title text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 'default')
);

insert into site_settings (id, site_title, logo_url)
values ('default', null, null)
on conflict (id) do nothing;

alter table projects
  add column if not exists deadline date;
