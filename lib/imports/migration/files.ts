// lib/imports/migration/files.ts
import { importBc2FileFromAttachment } from "../bc2-migrate-single-file";
import type { Bc2DownloadEnv } from "../bc2-attachment-download";
import type { Bc2Attachment } from "../bc2-fetcher";
import { resolveBc2AttachmentLinkage } from "../bc2-attachment-linkage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";
import { createFileMetadata } from "@/lib/repositories";
import type { DumpReader } from "../dump-reader";
import { logRecord, type DataSource, type Query } from "./jobs";
import type { MigratedProject } from "./types";

export async function migrateFiles(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  project: MigratedProject;
  downloadEnv: Bc2DownloadEnv;
  personMap: Map<number, string>;
}): Promise<{ files: { success: number; failed: number; skipped: number } }> {
  const { reader, q, jobId, project, downloadEnv, personMap } = args;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  let attRes;
  try {
    attRes = await reader.attachments(project.bc2Id);
  } catch (err) {
    await logRecord(q, {
      jobId,
      recordType: "file",
      sourceId: String(project.bc2Id),
      status: "failed",
      message: `attachments_fetch_failed: ${err instanceof Error ? err.message : String(err)}`,
      dataSource: "api",
    });
    return { files: { success: 0, failed: 0, skipped: 0 } };
  }

  const attachments: Bc2Attachment[] = Array.isArray(attRes.body) ? attRes.body : [];
  const dataSource: DataSource = attRes.source;

  if (attachments.length === 0) {
    return { files: { success, failed, skipped } };
  }

  // Look up storage_project_dir + archived once per project
  const projRow = await q<{ storage_project_dir: string | null; archived: boolean | null }>(
    "select storage_project_dir, archived from projects where id = $1",
    [project.localId],
  );
  if (!projRow.rows[0]) {
    await logRecord(q, {
      jobId,
      recordType: "file",
      sourceId: String(project.bc2Id),
      status: "failed",
      message: "project_row_not_found",
      dataSource: "api",
    });
    return { files: { success: 0, failed: 0, skipped: 0 } };
  }
  const storageDir = projRow.rows[0].storage_project_dir ?? "";
  const projectArchived = Boolean(projRow.rows[0].archived ?? false);

  const adapter = new DropboxStorageAdapter();

  // Helper-internal logRecord/incrementCounters are no-ops here; this phase
  // emits its own structured logs (with dataSource) per attachment.
  const noopLogRecord = async () => {};
  const noopIncrementCounters = async () => {};

  for (const attachment of attachments) {
    try {
      const { threadId, commentId } = await resolveBc2AttachmentLinkage(q, attachment);

      const result = await importBc2FileFromAttachment({
        query: q,
        jobId,
        projectLocalId: project.localId,
        storageDir,
        personMap,
        attachment,
        threadId,
        commentId,
        downloadEnv,
        adapter,
        createFileMetadata,
        logRecord: noopLogRecord,
        incrementCounters: noopIncrementCounters,
        projectArchived,
      });

      if (result.status === "imported") {
        success++;
        await logRecord(q, {
          jobId,
          recordType: "file",
          sourceId: String(attachment.id),
          status: "success",
          dataSource,
        });
      } else if (result.status === "skipped_existing") {
        skipped++;
        await logRecord(q, {
          jobId,
          recordType: "file",
          sourceId: String(attachment.id),
          status: "success",
          message: "skipped_existing",
          dataSource,
        });
      } else {
        failed++;
        await logRecord(q, {
          jobId,
          recordType: "file",
          sourceId: String(attachment.id),
          status: "failed",
          message: result.error,
          dataSource,
        });
      }
    } catch (err) {
      failed++;
      await logRecord(q, {
        jobId,
        recordType: "file",
        sourceId: String(attachment.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource,
      });
    }
  }

  return { files: { success, failed, skipped } };
}
