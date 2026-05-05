// lib/imports/migration/jobs.ts
import type { QueryResultRow } from "pg";

export type Query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

export type DataSource = "dump" | "api";

export async function createImportJob(q: Query, options: Record<string, unknown>): Promise<string> {
  const r = await q<{ id: string }>(
    "insert into import_jobs (status, options) values ('running', $1) returning id",
    [JSON.stringify(options)],
  );
  const row = r.rows[0];
  if (!row) throw new Error("createImportJob: insert returned no row");
  return row.id;
}

export async function logRecord(
  q: Query,
  args: {
    jobId: string;
    recordType: string;
    sourceId: string;
    status: "success" | "failed";
    message?: string | null;
    dataSource: DataSource;
  },
): Promise<void> {
  await q(
    "insert into import_logs (job_id, record_type, source_record_id, status, message, data_source) values ($1,$2,$3,$4,$5,$6)",
    [
      args.jobId,
      args.recordType,
      args.sourceId,
      args.status,
      args.message ?? null,
      args.dataSource,
    ],
  );
}

export async function incrementCounters(
  q: Query,
  jobId: string,
  success: number,
  failed: number,
): Promise<void> {
  await q(
    `update import_jobs set
       success_count = success_count + $2,
       failed_count  = failed_count  + $3,
       total_records = total_records + $2 + $3
     where id = $1`,
    [jobId, success, failed],
  );
}

export async function finishJob(
  q: Query,
  jobId: string,
  status: "completed" | "failed" | "interrupted",
): Promise<void> {
  await q(
    "update import_jobs set status=$2, finished_at=now() where id=$1",
    [jobId, status],
  );
}
