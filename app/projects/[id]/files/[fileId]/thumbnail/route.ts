import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getFileById, getProject, upsertThumbnailJob } from "@/lib/repositories";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  let projectId = "";
  let fileId = "";

  try {
    await requireUser(request);
    const resolvedParams = await params;
    projectId = resolvedParams.id;
    fileId = resolvedParams.fileId;
    const [project, file] = await Promise.all([getProject(projectId), getFileById(projectId, fileId)]);
    if (!project) {
      return notFound("Project not found");
    }
    if (!file) {
      return notFound("File not found");
    }

    const thumbnailUrl = getNonEmptyString((file as Record<string, unknown>).thumbnail_url);
    if (thumbnailUrl) {
      logThumbnailProxyCheck({
        projectId,
        fileId,
        httpStatus: 307,
        requestId,
        status: "ready",
        durationMs: Date.now() - startedAt
      });
      return NextResponse.redirect(thumbnailUrl, 307);
    }

    const fileRecord = file as Record<string, unknown>;
    const jobResult = await upsertThumbnailJob({ projectFileId: fileId });
    const responseStatus = jobResult.action === "deduped" ? "processing" : "queued";
    logThumbnailJobEnqueued({
      fileId,
      enqueueResult: jobResult.action,
      requestId
    });
    await notifyWorkerBestEffort({
      projectId,
      fileId,
      requestId,
      responseStatus,
      fileRecord,
      jobId: jobResult.job?.id ?? null
    });

    logThumbnailProxyCheck({
      projectId,
      fileId,
      httpStatus: 202,
      requestId,
      status: responseStatus,
      durationMs: Date.now() - startedAt
    });

    return NextResponse.json(
      {
        status: responseStatus,
        pollAfterMs: 2000
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return notFound(error.message);
    }
    logThumbnailProxyCheck({
      projectId,
      fileId,
      httpStatus: 500,
      requestId,
      status: "error",
      durationMs: Date.now() - startedAt
    });
    return serverError(error instanceof Error ? error.message : "Unable to load thumbnail");
  }
}

function getRequestId(request: Request) {
  return request.headers.get("x-request-id")?.trim() || randomUUID();
}

function getNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBearerToken(value: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/^Bearer\s+/i, "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function notifyWorkerBestEffort(args: {
  projectId: string;
  fileId: string;
  requestId: string;
  responseStatus: "queued" | "processing";
  fileRecord: Record<string, unknown>;
  jobId: string | null;
}) {
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

function logThumbnailProxyCheck(args: {
  projectId: string;
  fileId: string;
  httpStatus: number;
  requestId: string;
  status: string;
  durationMs: number;
}) {
  console.info("thumbnail_proxy_check", args);
}

function logThumbnailJobEnqueued(args: {
  fileId: string;
  enqueueResult: "inserted" | "deduped";
  requestId: string;
}) {
  console.info("thumbnail_job_enqueued", args);
}

function logThumbnailWorkerNotifySkipped(args: {
  projectId: string;
  fileId: string;
  requestId: string;
  reason: string;
}) {
  console.warn("thumbnail_worker_notify_skipped", args);
}
