// lib/imports/reconcile/reconcile-job.ts
import type { Pool } from "pg";
import type { ReconcileSummary } from "./types";

export type Phase = "project" | "file" | "discussion" | "comment";
export type Action = "inserted" | "duplicate" | "orphan" | "skipped" | "error";

export interface JobLogger {
  jobId: string;
  log(entry: {
    projectBc2Id: number | null;
    phase: Phase;
    action: Action;
    prodId?: number | null;
    testId?: number | null;
    reason?: string | null;
  }): Promise<void>;
  finish(status: "completed" | "failed" | "interrupted", summary: ReconcileSummary): Promise<void>;
}

export async function startJob(
  pool: Pool,
  opts: { dryRun: boolean },
): Promise<JobLogger> {
  const r = await pool.query(
    `INSERT INTO reconcile_jobs (status, dry_run) VALUES ('running', $1) RETURNING id`,
    [opts.dryRun],
  );
  const jobId: string = r.rows[0].id;

  async function log(entry: {
    projectBc2Id: number | null;
    phase: Phase;
    action: Action;
    prodId?: number | null;
    testId?: number | null;
    reason?: string | null;
  }) {
    if (opts.dryRun) return;
    await pool.query(
      `INSERT INTO reconcile_logs (job_id, project_bc2_id, phase, action, prod_id, test_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        jobId,
        entry.projectBc2Id,
        entry.phase,
        entry.action,
        entry.prodId ?? null,
        entry.testId ?? null,
        entry.reason ?? null,
      ],
    );
  }

  async function finish(status: "completed" | "failed" | "interrupted", summary: ReconcileSummary) {
    await pool.query(
      `UPDATE reconcile_jobs SET status = $1, finished_at = now(), summary_json = $2 WHERE id = $3`,
      [status, summary, jobId],
    );
  }

  return { jobId, log, finish };
}
