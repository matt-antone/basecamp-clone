import { config } from "@/lib/config-core";

export function normalizeBearerToken(value: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/^Bearer\s+/i, "").trim();
  return normalized.length > 0 ? normalized : null;
}

function logThumbnailWorkerNotifySkipped(args: {
  projectId: string;
  fileId: string;
  requestId: string;
  reason: string;
}) {
  console.warn("thumbnail_worker_notify_skipped", args);
}

export async function notifyThumbnailWorkerBestEffort(args: {
  projectId: string;
  fileId: string;
  requestId: string;
  responseStatus: "queued" | "processing";
  fileRecord: Record<string, unknown>;
  jobId: string | null;
}): Promise<void> {
  let workerUrl: string | null = null;
  try {
    workerUrl = config.thumbnailWorkerUrl();
  } catch (error) {
    logThumbnailWorkerNotifySkipped({
      projectId: args.projectId,
      fileId: args.fileId,
      requestId: args.requestId,
      reason: error instanceof Error ? error.message : "invalid_worker_url"
    });
    return;
  }

  const workerToken = normalizeBearerToken(config.thumbnailWorkerToken());
  if (!workerUrl || !workerToken) {
    logThumbnailWorkerNotifySkipped({
      projectId: args.projectId,
      fileId: args.fileId,
      requestId: args.requestId,
      reason: !workerUrl ? "missing_worker_url" : "missing_worker_token"
    });
    return;
  }

  const workerEndpoint = new URL("/thumbnails", `${workerUrl}/`).toString();

  try {
    const workerResponse = await fetch(workerEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
        "x-request-id": args.requestId
      },
      body: JSON.stringify({
        projectId: args.projectId,
        fileId: args.fileId,
        projectFileId: args.fileId,
        dropboxFileId: String(args.fileRecord.dropbox_file_id ?? ""),
        dropboxPath: String(args.fileRecord.dropbox_path ?? ""),
        filename: String(args.fileRecord.filename ?? ""),
        mimeType: String(args.fileRecord.mime_type ?? ""),
        jobId: args.jobId,
        status: args.responseStatus
      })
    });

    if (!workerResponse.ok) {
      logThumbnailWorkerNotifySkipped({
        projectId: args.projectId,
        fileId: args.fileId,
        requestId: args.requestId,
        reason: `worker_http_${workerResponse.status}`
      });
    }
  } catch (error) {
    logThumbnailWorkerNotifySkipped({
      projectId: args.projectId,
      fileId: args.fileId,
      requestId: args.requestId,
      reason: error instanceof Error ? error.message : "worker_notify_failed"
    });
  }
}
