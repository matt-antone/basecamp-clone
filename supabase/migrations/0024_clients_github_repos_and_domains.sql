alter table clients
  add column if not exists github_repos text[] not null default '{}'::text[],
  add column if not exists domains text[] not null default '{}'::text[];

comment on column clients.github_repos is 'Optional GitHub repositories related to the client.';
comment on column clients.domains is 'Optional domains related to the client.';
