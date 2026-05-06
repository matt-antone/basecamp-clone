-- 0030_reconcile_logs.sql
-- Tables for the prod->test active-project reconcile script.

CREATE TABLE IF NOT EXISTS reconcile_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
  dry_run boolean NOT NULL,
  summary_json jsonb
);

CREATE TABLE IF NOT EXISTS reconcile_logs (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES reconcile_jobs(id) ON DELETE CASCADE,
  project_bc2_id bigint,
  phase text NOT NULL CHECK (phase IN ('project','file','discussion','comment')),
  action text NOT NULL CHECK (action IN ('inserted','duplicate','orphan','skipped','error')),
  prod_id bigint,
  test_id bigint,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconcile_logs_job_id_idx ON reconcile_logs(job_id);
CREATE INDEX IF NOT EXISTS reconcile_logs_project_bc2_id_idx ON reconcile_logs(project_bc2_id);
