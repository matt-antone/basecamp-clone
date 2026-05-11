// lib/imports/sync-prod-to-test/sync-job.ts
//
// DB job logging is deferred to a future migration. This stub keeps the
// interface stable for callers. Audit lives in dated CSVs under
// docs/reconcile/extracts/<ISO>/.

export type LogLevel = "info" | "warn" | "error";

export interface SyncJobHandle {
  jobId: string;
  log(level: LogLevel, message: string, context?: Record<string, unknown>): Promise<void>;
  finalize(status: "completed" | "failed", summary?: Record<string, unknown>): Promise<void>;
}

export interface SyncJobLogEntry {
  level: LogLevel;
  message: string;
  context: Record<string, unknown> | null;
  at: Date;
}

export async function startSyncJob(jobId: string): Promise<SyncJobHandle & { entries(): SyncJobLogEntry[]; finalSummary(): { status: "completed" | "failed"; summary: Record<string, unknown> | null } | null }> {
  const entries: SyncJobLogEntry[] = [];
  let final: { status: "completed" | "failed"; summary: Record<string, unknown> | null } | null = null;
  return {
    jobId,
    async log(level, message, context) {
      entries.push({ level, message, context: context ?? null, at: new Date() });
      const prefix = level === "error" ? "ERROR" : level === "warn" ? "WARN " : "INFO ";
      console.log(`[${prefix}] ${message}${context ? " " + JSON.stringify(context) : ""}`);
    },
    async finalize(status, summary) {
      final = { status, summary: summary ?? null };
      console.log(`[DONE] job=${jobId} status=${status}${summary ? " " + JSON.stringify(summary) : ""}`);
    },
    entries: () => entries.slice(),
    finalSummary: () => final,
  };
}
