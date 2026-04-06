-- Full-text search support for projects workspace (see docs/superpowers/specs/2026-03-31-projects-workspace-ux-search-design.md).
-- btree index on projects(client_id) already exists: idx_projects_client_id (0002_clients.sql).

-- IMMUTABLE helper: array_to_string is actually deterministic for text arrays
-- but is marked STABLE in pg_proc due to locale paths that don't apply here.
create or replace function text_array_to_string(arr text[])
  returns text language sql immutable parallel safe as $$
    select coalesce(array_to_string(arr, ' '), '')
  $$;

-- Combined project fields: English stemming for prose, tags as space-joined text.
create index if not exists idx_projects_fts_search
  on projects using gin (
    to_tsvector(
      'english'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(project_code, '') || ' ' ||
      text_array_to_string(tags)
    )
  );

-- Client name + code (joined in queries; same config as project-adjacent prose).
create index if not exists idx_clients_fts_search
  on clients using gin (
    to_tsvector('english'::regconfig, coalesce(name, '') || ' ' || coalesce(code, ''))
  );

create index if not exists idx_discussion_threads_fts_search
  on discussion_threads using gin (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body_markdown, ''))
  );

create index if not exists idx_discussion_comments_fts_search
  on discussion_comments using gin (
    to_tsvector('english'::regconfig, coalesce(body_markdown, ''))
  );

-- Filenames: simple config avoids English stemmer mangling tokens.
create index if not exists idx_project_files_fts_search
  on project_files using gin (
    to_tsvector('simple'::regconfig, coalesce(filename, ''))
  );
