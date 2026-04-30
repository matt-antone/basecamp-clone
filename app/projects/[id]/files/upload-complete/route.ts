import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { del } from "@vercel/blob";
import { requireUser } from "@/lib/auth";
import { enqueueThumbnailJobAndNotifyBestEffort } from "@/lib/thumbnail-enqueue-after-save";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir } from "@/lib/project-storage";
import {
  assertClientNotArchivedForMutation,
  createFileMetadata,
  finalizeFileMetadataAfterTransfer,
  getComment,
  getProject,
  getThread,
  markFileTransferFailed,
  markFileTransferInProgress
} from "@/lib/repositories";
import {
  DropboxStorageAdapter,
  getDropboxErrorSummary,
  isTeamSelectUserRequiredError
} from "@/lib/storage/dropbox-adapter";
import { z } from "zod";

const uploadCompleteSchema = z.object({
  blobUrl: z.string().url(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  threadId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional()
}).superRefine((value, ctx) => {
  if (value.commentId && !value.threadId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "threadId is required when commentId is provided",
      path: ["threadId"]
    });
  }
});

const DROPBOX_AUTH_ERROR_PATTERN =
  /auth|token|workspace|invalid_access_token|expired_access_token|invalid_grant|not_authed|missing_scope/i;
const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id: projectId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return notFound("Project not found");
    }

    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before uploading files.",
      inProgress: "Client archive is in progress. File uploads are temporarily disabled."
    });

    let payload: z.infer<typeof uploadCompleteSchema>;
    try {
      payload = uploadCompleteSchema.parse(await request.json());
    } catch (parseError) {
      if (parseError instanceof z.ZodError) {
        return badRequest(parseError.message);
      }
      return badRequest("Invalid JSON body");
    }

    if (payload.threadId) {
      const thread = await getThread(projectId, payload.threadId);
      if (!thread) {
        return notFound("Thread not found");
      }
    }

    if (payload.commentId && payload.threadId) {
      const comment = await getComment(projectId, payload.threadId, payload.commentId);
      if (!comment) {
        return notFound("Comment not found");
      }
    }

    // `thread_id` / `comment_id` are null for project-level uploads (project Files tab) and for
    // some imports. Comment attachments send both ids after the comment exists (see discussion page).
    const file = await createFileMetadata({
      projectId,
      uploaderUserId: user.id,
      filename: payload.filename,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      dropboxFileId: null,
      dropboxPath: null,
      checksum: null,
      threadId: payload.threadId ?? null,
      commentId: payload.commentId ?? null,
      status: "pending",
      blobUrl: payload.blobUrl
    });

    if (!file) {
      throw new Error("Failed to create file metadata");
    }

    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();

    after(async () => {
      try {
        await markFileTransferInProgress(file.id);

        const blobResponse = await fetch(payload.blobUrl);
        if (!blobResponse.ok) {
          throw new Error(`Failed to fetch blob: ${blobResponse.status}`);
        }
        const content = Buffer.from(await blobResponse.arrayBuffer());
        const checksum = createHash("sha256").update(content).digest("hex");

        const adapter = new DropboxStorageAdapter();
        const projectStorageDir = getProjectStorageDir(project);
        const targetPath = `${projectStorageDir}/uploads/${payload.filename}`;

        const completed = await adapter.uploadComplete({
          sessionId: randomUUID(),
          targetPath,
          filename: payload.filename,
          content,
          mimeType: payload.mimeType
        });

        await finalizeFileMetadataAfterTransfer({
          fileId: file.id,
          dropboxFileId: completed.fileId,
          dropboxPath: completed.path,
          checksum
        });

        const enrichedRecord = {
          ...file,
          dropbox_file_id: completed.fileId,
          dropbox_path: completed.path,
          checksum,
          status: "ready",
          blob_url: null
        };

        await enqueueThumbnailJobAndNotifyBestEffort({
          projectId,
          fileRecord: enrichedRecord as Record<string, unknown>,
          requestId,
          projectArchived: Boolean(project.archived)
        });
      } catch (error) {
        const summary = getDropboxErrorSummary(error);
        await markFileTransferFailed({ fileId: file.id, error: summary });
        console.error("upload_transfer_failed", { fileId: file.id, requestId, summary });
      } finally {
        try {
          await del(payload.blobUrl);
        } catch (cleanupError) {
          console.error("blob_cleanup_failed", { blobUrl: payload.blobUrl, cleanupError });
        }
      }
    });

    return ok({ file }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (isTeamSelectUserRequiredError(error)) {
      return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
    }
    const errorSummary = getDropboxErrorSummary(error);
    if (DROPBOX_AUTH_ERROR_PATTERN.test(errorSummary)) {
      return unauthorized(errorSummary);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    console.error("upload_complete_failed", { errorSummary, error });
    return serverError(errorSummary || (error instanceof Error ? error.message : "Upload failed"));
  }
}
