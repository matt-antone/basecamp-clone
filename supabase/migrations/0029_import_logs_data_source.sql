-- supabase/migrations/0029_import_logs_data_source.sql
-- Adds data_source so the new dump-based migrator can record whether each
-- record came from the local BC2 dump or the live BC2 API. Default 'api'
-- preserves the meaning of all existing rows from scripts/migrate-bc2.ts.

alter table import_logs
  add column if not exists data_source text not null default 'api';

create index if not exists import_logs_job_data_source_idx
  on import_logs (job_id, data_source);
