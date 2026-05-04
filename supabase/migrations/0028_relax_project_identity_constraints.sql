-- supabase/migrations/0028_relax_project_identity_constraints.sql
-- Allow projects without an assigned identity (no-code path) and let
-- variant projects share project_seq. project_code remains the unique
-- identity guard.

alter table projects
  alter column project_code drop not null,
  alter column project_seq drop not null,
  alter column client_slug drop not null,
  alter column project_slug drop not null,
  alter column storage_project_dir drop not null;

-- Variant projects (MMR-049A, MMR-049B, ...) share project_seq=49 by design.
-- The unique guard moves entirely to project_code.
drop index if exists idx_projects_client_seq_unique;
