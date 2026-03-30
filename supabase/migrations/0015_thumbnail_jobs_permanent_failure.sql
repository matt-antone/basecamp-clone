alter table thumbnail_jobs
  drop constraint if exists thumbnail_jobs_status_check;

alter table thumbnail_jobs
  add constraint thumbnail_jobs_status_check
  check (status in ('queued', 'processing', 'succeeded', 'failed', 'permanent_failure'));
