import { randomUUID } from "node:crypto";
import { upsertThumbnailJob } from "@/lib/repositories";
import { notifyThumbnailWorkerBestEffort } from "@/lib/thumbnail-worker-notify";

/**
 * Thumbnail jobs are only enqueued for non-archived (live) projects.
 * When `archived` is omitted, the project is treated as live.
 */
export function shouldEnqueueThumbnailForProject(project: { archived?: boolean }): boolean {
  return project.archived !== true;
}

function getNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * After persisting a project_files row, enqueue a thumbnail job and best-effort notify the worker.
 * Never throws; failures are logged with `thumbnail_enqueue_after_save_failed`.
 */
export async function enqueueThumbnailJobAndNotifyBestEffort(args: {
  projectId: string;
  fileRecord: Record<string, unknown>;
  requestId?: string;
  /** When true (archived project), skip enqueue and notify. Omitted/false = live. */
  projectArchived?: boolean;
}): Promise<void> {
  const requestId = args.requestId?.trim() || randomUUID();

  if (!shouldEnqueueThumbnailForProject({ archived: args.projectArchived })) {
    console.debug("thumbnail_enqueue_skipped", {
      projectId: args.projectId,
      requestId,
      reason: "archived_project"
    });
    return;
  }

  if (getNonEmptyString(args.fileRecord.thumbnail_url)) {
    return;
  }

  const rawId = args.fileRecord.id;
  if (rawId === undefined || rawId === null) {
    console.warn("thumbnail_enqueue_after_save_failed", {
      projectId: args.projectId,
      requestId,
      reason: "missing_file_id"
    });
    return;
  }
  const fileId = String(rawId);

  try {
    const jobResult = await upsertThumbnailJob({ projectFileId: fileId });

    if (jobResult.action === "permanent_failure") {
      return;
    }

    const responseStatus = jobResult.action === "deduped" ? "processing" : "queued";
    await notifyThumbnailWorkerBestEffort({
      projectId: args.projectId,
      fileId,
      requestId,
      responseStatus,
      fileRecord: args.fileRecord,
      jobId: jobResult.job?.id ?? null
    });
  } catch (error) {
    console.warn("thumbnail_enqueue_after_save_failed", {
      projectId: args.projectId,
      fileId,
      requestId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}
