-- Reverts 0023_project_files_transfer_status.sql.
-- Direct-to-Dropbox upload pattern (no transit storage) eliminates the need for a
-- transfer lifecycle on project_files. Idempotent so it runs cleanly whether or not
-- 0023 has been applied to the target environment.

drop index if exists project_files_status_idx;

alter table project_files drop column if exists status;
alter table project_files drop column if exists transfer_error;
alter table project_files drop column if exists blob_url;

-- Restore NOT NULL constraints relaxed by 0023. Rows in flight under the
-- now-removed lifecycle would be 'pending' / 'in_progress' with NULL Dropbox columns;
-- the steps below assume those rows have either completed (status='ready' before
-- the column drop) or been manually cleaned. If any rows still have NULL Dropbox
-- columns, the SET NOT NULL will fail loudly — investigate before re-running.

alter table project_files alter column dropbox_file_id set not null;
alter table project_files alter column dropbox_path set not null;
alter table project_files alter column checksum set not null;
