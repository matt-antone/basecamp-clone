-- Basecamp 2 attachment id for BC-imported files; enables idempotent re-import per project.
alter table project_files
  add column if not exists bc_attachment_id text null;

comment on column project_files.bc_attachment_id is
  'Basecamp 2 attachment id for BC-imported files; null for native uploads.';

create unique index if not exists idx_project_files_project_bc_attachment_unique
  on project_files (project_id, bc_attachment_id)
  where bc_attachment_id is not null;
