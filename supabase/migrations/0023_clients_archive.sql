-- Archived clients + Dropbox archive job metadata.
--
-- RLS: No row level security is enabled on `clients` in this project; server routes use the
-- database pool (service role / direct SQL). This migration does not add RLS policies.

alter table clients
  add column if not exists archived_at timestamptz null,
  add column if not exists dropbox_archive_status text not null default 'idle',
  add column if not exists archive_started_at timestamptz null,
  add column if not exists archive_error text null;

alter table clients
  add constraint clients_dropbox_archive_status_check
  check (
    dropbox_archive_status in (
      'idle',
      'pending',
      'in_progress',
      'completed',
      'failed'
    )
  );

comment on column clients.archived_at is 'When set, the client is treated as archived in-app.';
comment on column clients.dropbox_archive_status is 'Dropbox folder move job: idle | pending | in_progress | completed | failed.';
comment on column clients.archive_started_at is 'When the current/last archive job started.';
comment on column clients.archive_error is 'Last failure message when dropbox_archive_status is failed.';

create index if not exists idx_clients_archived_at on clients (archived_at);
create index if not exists idx_clients_dropbox_archive_status on clients (dropbox_archive_status);
