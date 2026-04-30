-- Transfer lifecycle tracking for async Dropbox upload bypass pattern.
-- Makes Dropbox-derived columns nullable so a row can exist before transfer completes.
-- Existing rows default to 'ready' (already in Dropbox).

alter table project_files
  alter column dropbox_file_id drop not null;

alter table project_files
  alter column dropbox_path drop not null;

alter table project_files
  alter column checksum drop not null;

-- Transfer status: 'pending' → 'in_progress' → 'ready' | 'failed'
alter table project_files
  add column if not exists status text not null default 'ready';

alter table project_files
  add column if not exists transfer_error text;

alter table project_files
  add column if not exists blob_url text;

create index if not exists project_files_status_idx
  on project_files (status) where status <> 'ready';
