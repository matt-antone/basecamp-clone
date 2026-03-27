-- agent_clients: stores per-agent credentials (replaces MCP_CLIENTS_JSON env var)
create table if not exists agent_clients (
  client_id   text primary key,
  secret_hash text not null,
  role        text not null default 'agent',
  disabled    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- agent_profiles: editable identity per agent, auto-created on first auth
create table if not exists agent_profiles (
  client_id   text primary key references agent_clients(client_id) on delete cascade,
  name        text,
  avatar_url  text,
  bio         text,
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Full-text search RPC: searches threads and comments across the project
create or replace function mcp_search_content(
  p_query text,
  p_project_id uuid default null,
  p_limit int default 20
)
returns table (
  result_type text,
  result_id uuid,
  project_id uuid,
  title text,
  excerpt text,
  created_at timestamptz
)
language sql stable as $$
  select
    'thread' as result_type,
    t.id as result_id,
    t.project_id,
    t.title,
    left(t.body_markdown, 200) as excerpt,
    t.created_at
  from discussion_threads t
  where
    to_tsvector('english', t.title || ' ' || t.body_markdown) @@ plainto_tsquery('english', p_query)
    and (p_project_id is null or t.project_id = p_project_id)
  union all
  select
    'comment' as result_type,
    c.id as result_id,
    c.project_id,
    null as title,
    left(c.body_markdown, 200) as excerpt,
    c.created_at
  from discussion_comments c
  where
    to_tsvector('english', c.body_markdown) @@ plainto_tsquery('english', p_query)
    and (p_project_id is null or c.project_id = p_project_id)
  order by created_at desc
  limit least(p_limit, 100)
$$;
