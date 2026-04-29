// lib/imports/bc2-migrate-single-file.ts

import type { QueryResultRow } from "pg";
import {
  enqueueThumbnailJobAndNotifyBestEffort,
  shouldEnqueueThumbnailForProject
} from "../thumbnail-enqueue-after-save";
import { downloadBc2Attachment, type Bc2DownloadEnv } from "./bc2-attachment-download";
import { parseBc2IsoTimestamptz, type Bc2Attachment } from "./bc2-fetcher";
import { createFileMetadata } from "../repositories";
import type { DropboxStorageAdapter } from "../storage/dropbox-adapter";

const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 2000;

type ImportBc2FileResult =
  | { status: "imported"; localFileId: string }
  | { status: "skipped_existing"; localFileId: string }
  | { status: "failed"; error: string };

type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) => Promise<{ rows: T[] }>;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

type ImportBc2FileFromAttachmentArgs = {
  query: QueryFn;
  jobId: string;
  projectLocalId: string;
  storageDir: string;
  personMap: Map<number, string>;
  attachment: Bc2Attachment;
  threadId: string | null;
  commentId: string | null;
  downloadEnv: Bc2DownloadEnv;
  adapter: Pick<DropboxStorageAdapter, "uploadComplete">;
  createFileMetadata: typeof createFileMetadata;
  logRecord: (
    jobId: string,
    recordType: string,
    sourceId: string,
    status: "success" | "failed",
    message?: string
  ) => Promise<void>;
  incrementCounters: (jobId: string, success: number, failed: number) => Promise<void>;
  onDownload429?: (attachmentId: number, waitMs: number) => void;
  retryAttempts?: number;
  retryDelayMs?: number;
  /** When true, skip thumbnail enqueue (archived projects). */
  projectArchived?: boolean;
};

/**
 * Idempotent: if import_map_files already has basecamp_file_id, returns that local file without downloading.
 * If project_files already has bc_attachment_id for this project (e.g. map row missing from a partial run),
 * skips download and backfills import_map_files when needed.
 * Otherwise downloads from BC2, uploads to Dropbox, inserts project_files (with optional thread/comment),
 * and records import_map_files.
 */
export async function importBc2FileFromAttachment(
  args: ImportBc2FileFromAttachmentArgs
): Promise<ImportBc2FileResult> {
  const attempts = args.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const retryDelayMs = args.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const { attachment } = args;
  const bcKey = String(attachment.id);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const existing = await args.query<{ local_file_id: string }>(
        "select local_file_id from import_map_files where basecamp_file_id = $1",
        [bcKey]
      );
      if (existing.rows[0]) {
        const localFileId = existing.rows[0].local_file_id;
        if (args.threadId != null || args.commentId != null) {
          await args.query(
            `update project_files
                set thread_id  = coalesce(thread_id,  $2::uuid),
                    comment_id = coalesce(comment_id, $3::uuid)
              where id = $1::uuid
                and (thread_id is null or comment_id is null)`,
            [localFileId, args.threadId ?? null, args.commentId ?? null]
          );
        }
        return { status: "skipped_existing", localFileId };
      }

      const existingByBc = await args.query<{ id: string }>(
        "select id from project_files where project_id = $1 and bc_attachment_id = $2 limit 1",
        [args.projectLocalId, bcKey]
      );
      if (existingByBc.rows[0]) {
        const localFileId = existingByBc.rows[0].id;
        await args.query(
          "insert into import_map_files (basecamp_file_id, local_file_id) values ($1, $2) on conflict (basecamp_file_id) do nothing",
          [bcKey, localFileId]
        );
        if (args.threadId != null || args.commentId != null) {
          await args.query(
            `update project_files
                set thread_id  = coalesce(thread_id,  $2::uuid),
                    comment_id = coalesce(comment_id, $3::uuid)
              where id = $1::uuid
                and (thread_id is null or comment_id is null)`,
            [localFileId, args.threadId ?? null, args.commentId ?? null]
          );
        }
        return {
          status: "skipped_existing",
          localFileId
        };
      }

      const arrayBuffer = await downloadBc2Attachment(attachment.url, args.downloadEnv, {
        onBackoff: (waitMs) => args.onDownload429?.(attachment.id, waitMs)
      });
      const buffer = Buffer.from(arrayBuffer);
      const safeFilename = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const targetPath = `${args.storageDir}/uploads/${safeFilename}`;

      const uploaded = await args.adapter.uploadComplete({
        sessionId: attachment.id.toString(),
        targetPath,
        filename: attachment.name,
        content: buffer,
        mimeType: attachment.content_type
      });

      const uploaderUserId =
        args.personMap.get(attachment.creator.id) ?? `bc2_${attachment.creator.id}`;

      const sourceCreatedAt =
        parseBc2IsoTimestamptz(attachment.created_at) ?? undefined;
      const fileRecord = await args.createFileMetadata({
        projectId: args.projectLocalId,
        uploaderUserId,
        filename: attachment.name,
        mimeType: attachment.content_type,
        sizeBytes: attachment.byte_size,
        dropboxFileId: uploaded.fileId,
        dropboxPath: uploaded.path,
        checksum: "",
        threadId: args.threadId,
        commentId: args.commentId,
        bcAttachmentId: bcKey,
        sourceCreatedAt,
        status: "ready",
        blobUrl: null
      });
      if (!fileRecord) {
        throw new Error(`createFileMetadata returned null for attachment ${attachment.id}`);
      }
      const localFileId = fileRecord.id as string;

      if (shouldEnqueueThumbnailForProject({ archived: args.projectArchived })) {
        await enqueueThumbnailJobAndNotifyBestEffort({
          projectId: args.projectLocalId,
          fileRecord: fileRecord as Record<string, unknown>,
          requestId: `bc2-${args.jobId}-${attachment.id}`
        });
      }

      try {
        await args.query(
          "insert into import_map_files (basecamp_file_id, local_file_id) values ($1, $2)",
          [String(attachment.id), localFileId]
        );
      } catch (insertErr) {
        if (isUniqueViolation(insertErr)) {
          const raced = await args.query<{ local_file_id: string }>(
            "select local_file_id from import_map_files where basecamp_file_id = $1",
            [String(attachment.id)]
          );
          if (raced.rows[0]) {
            const localFileId = raced.rows[0].local_file_id;
            if (args.threadId != null || args.commentId != null) {
              await args.query(
                `update project_files
                    set thread_id  = coalesce(thread_id,  $2::uuid),
                        comment_id = coalesce(comment_id, $3::uuid)
                  where id = $1::uuid
                    and (thread_id is null or comment_id is null)`,
                [localFileId, args.threadId ?? null, args.commentId ?? null]
              );
            }
            return {
              status: "skipped_existing",
              localFileId
            };
          }
        }
        throw insertErr;
      }

      await args.logRecord(args.jobId, "file", String(attachment.id), "success");
      await args.incrementCounters(args.jobId, 1, 0);
      return { status: "imported", localFileId };
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  await args.logRecord(args.jobId, "file", String(attachment.id), "failed", msg);
  await args.incrementCounters(args.jobId, 0, 1);
  return { status: "failed", error: msg };
}
