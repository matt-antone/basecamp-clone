import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  assertClientNotArchivedForMutation,
  createFileMetadata,
  getComment,
  getProject,
  getThread
} from "@/lib/repositories";
import { enqueueThumbnailJobAndNotifyBestEffort } from "@/lib/thumbnail-enqueue-after-save";
import { badRequest, conflict, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir } from "@/lib/project-storage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

const completeSchema = z.object({
  targetPath: z.string().min(1).max(1024),
  requestId: z.string().min(1).max(128),
  threadId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional()
}).superRefine((value, ctx) => {
  if (value.commentId && !value.threadId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "commentId requires threadId"
    });
  }
});

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;
const DROPBOX_PATH_NOT_FOUND_PATTERN = /path_not_found|path\/not_found/i;
const MIME_TYPE_PATTERN = /^[a-zA-Z0-9!#$&^_.+-]{1,127}\/[a-zA-Z0-9!#$&^_.+-]{1,127}(?:\s*;\s*[a-zA-Z0-9!#$&^_.+-]+=("[\x20-\x7E]*"|[a-zA-Z0-9!#$&^_.+-]+))?$/;

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

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

    const body = await request.json().catch(() => null);
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }
    const payload = parsed.data;

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

    const expectedPrefix = `${getProjectStorageDir(project)}/uploads/`;
    if (!payload.targetPath.startsWith(expectedPrefix)) {
      console.warn("upload_complete_path_attribution_blocked", {
        projectId,
        targetPath: payload.targetPath,
        expectedPrefix
      });
      return forbidden("Uploaded file is outside the project's storage area");
    }

    const adapter = new DropboxStorageAdapter();
    let metadata;
    try {
      metadata = await adapter.getFileMetadata({ targetPath: payload.targetPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (DROPBOX_PATH_NOT_FOUND_PATTERN.test(message)) {
        return notFound("Uploaded file not found in Dropbox");
      }
      throw error;
    }

    if (!metadata.pathDisplay.startsWith(expectedPrefix)) {
      console.warn("upload_complete_path_attribution_blocked", {
        projectId,
        targetPath: payload.targetPath,
        pathDisplay: metadata.pathDisplay,
        expectedPrefix
      });
      return forbidden("Uploaded file is outside the project's storage area");
    }

    const rawMimeHeader = request.headers.get("x-original-mime-type");
    if (rawMimeHeader !== null && !MIME_TYPE_PATTERN.test(rawMimeHeader.slice(0, 255))) {
      return badRequest("Invalid x-original-mime-type header");
    }
    const mimeType = rawMimeHeader?.slice(0, 255) ?? "application/octet-stream";

    const file = await createFileMetadata({
      projectId,
      uploaderUserId: user.id,
      filename: basename(metadata.pathDisplay),
      mimeType,
      sizeBytes: metadata.size,
      dropboxFileId: metadata.fileId,
      dropboxPath: metadata.pathDisplay,
      checksum: metadata.contentHash,
      threadId: payload.threadId ?? null,
      commentId: payload.commentId ?? null
    });

    if (!file) {
      return serverError("Failed to persist file metadata");
    }

    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId,
      fileRecord: file as unknown as Record<string, unknown>,
      requestId: payload.requestId,
      projectArchived: Boolean(project.archived)
    });

    return ok({ file });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    console.error("upload_complete_failed", { error });
    return serverError(error instanceof Error ? error.message : "Upload failed");
  }
}
