// lib/imports/bc2-migrate-single-file.ts

import type { QueryResultRow } from "pg";
import { enqueueThumbnailJobAndNotifyBestEffort } from "../thumbnail-enqueue-after-save";
import { downloadBc2Attachment, type Bc2DownloadEnv } from "./bc2-attachment-download";
import { parseBc2IsoTimestamptz, type Bc2Attachment } from "./bc2-fetcher";
import { createFileMetadata } from "../repositories";
import type { DropboxStorageAdapter } from "../storage/dropbox-adapter";

const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 2000;

export type ImportBc2FileResult =
  | { status: "imported"; localFileId: string }
  | { status: "skipped_existing"; localFileId: string }
  | { status: "failed"; error: string };

export type QueryFn = <T extends QueryResultRow = QueryResultRow>(
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

export type ImportBc2FileFromAttachmentArgs = {
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
};

/**
 * Idempotent: if import_map_files already has basecamp_file_id, returns that local file without downloading.
 * Otherwise downloads from BC2, uploads to Dropbox, inserts project_files (with optional thread/comment),
 * and records import_map_files.
 */
export async function importBc2FileFromAttachment(
  args: ImportBc2FileFromAttachmentArgs
): Promise<ImportBc2FileResult> {
  const attempts = args.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const retryDelayMs = args.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const { attachment } = args;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const existing = await args.query<{ local_file_id: string }>(
        "select local_file_id from import_map_files where basecamp_file_id = $1",
        [String(attachment.id)]
      );
      if (existing.rows[0]) {
        return {
          status: "skipped_existing",
          localFileId: existing.rows[0].local_file_id
        };
      }

      const arrayBuffer = await downloadBc2Attachment(attachment.url, args.downloadEnv, {
        onBackoff: (waitMs) => args.onDownload429?.(attachment.id, waitMs)
      });
      const buffer = Buffer.from(arrayBuffer);
      const safeFilename = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const targetPath = `${args.storageDir}/uploads/${Date.now()}-${attachment.id}-${safeFilename}`;

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
        sourceCreatedAt
      });
      if (!fileRecord) {
        throw new Error(`createFileMetadata returned null for attachment ${attachment.id}`);
      }
      const localFileId = fileRecord.id as string;

      await enqueueThumbnailJobAndNotifyBestEffort({
        projectId: args.projectLocalId,
        fileRecord: fileRecord as Record<string, unknown>,
        requestId: `bc2-${args.jobId}-${attachment.id}`
      });

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
            return {
              status: "skipped_existing",
              localFileId: raced.rows[0].local_file_id
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
