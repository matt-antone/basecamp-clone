import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { enqueueThumbnailJobAndNotifyBestEffort } from "@/lib/thumbnail-enqueue-after-save";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createFileMetadata, getComment, getProject, getThread } from "@/lib/repositories";
import {
  DropboxStorageAdapter,
  getDropboxErrorSummary,
  isTeamSelectUserRequiredError,
  mapDropboxMetadata
} from "@/lib/storage/dropbox-adapter";
import { z } from "zod";

const uploadCompleteJsonSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  contentBase64: z.string().min(1),
  sessionId: z.string().min(1),
  targetPath: z.string().min(1),
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

const uploadCompleteFormFieldsSchema = z.object({
  sessionId: z.string().min(1),
  targetPath: z.string().min(1),
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

async function parseUploadCompleteRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const rawThreadId = formData.get("threadId");
    const rawCommentId = formData.get("commentId");
    const file = formData.get("file");
    const payload = uploadCompleteFormFieldsSchema.parse({
      sessionId: formData.get("sessionId"),
      targetPath: formData.get("targetPath"),
      threadId: typeof rawThreadId === "string" && rawThreadId.length > 0 ? rawThreadId : undefined,
      commentId: typeof rawCommentId === "string" && rawCommentId.length > 0 ? rawCommentId : undefined
    });

    if (!(file instanceof File) || !file.name.trim()) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: "file is required",
          path: ["file"]
        }
      ]);
    }

    const content = Buffer.from(await file.arrayBuffer());
    return {
      ...payload,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      checksum: createHash("sha256").update(content).digest("hex"),
      content
    };
  }

  const payload = uploadCompleteJsonSchema.parse(await request.json());
  return {
    ...payload,
    content: Buffer.from(payload.contentBase64, "base64")
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }

    const payload = await parseUploadCompleteRequest(request);
    if (payload.threadId) {
      const thread = await getThread(id, payload.threadId);
      if (!thread) {
        return notFound("Thread not found");
      }
    }
    if (payload.commentId && payload.threadId) {
      const comment = await getComment(id, payload.threadId, payload.commentId);
      if (!comment) {
        return notFound("Comment not found");
      }
    }

    const adapter = new DropboxStorageAdapter();
    const completed = await adapter.uploadComplete({
      sessionId: payload.sessionId,
      targetPath: payload.targetPath,
      filename: payload.filename,
      content: payload.content,
      mimeType: payload.mimeType
    });

    const metadata = mapDropboxMetadata({
      projectId: id,
      uploaderUserId: user.id,
      filename: payload.filename,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      checksum: payload.checksum,
      dropboxFileId: completed.fileId,
      dropboxPath: completed.path
    });

    // `thread_id` / `comment_id` are null for project-level uploads (project Files tab) and for
    // some imports. Comment attachments send both ids after the comment exists (see discussion page).
    const file = await createFileMetadata({
      projectId: metadata.project_id,
      uploaderUserId: metadata.uploader_user_id,
      filename: metadata.filename,
      mimeType: metadata.mime_type,
      sizeBytes: metadata.size_bytes,
      dropboxFileId: metadata.dropbox_file_id,
      dropboxPath: metadata.dropbox_path,
      checksum: metadata.checksum,
      threadId: payload.threadId ?? null,
      commentId: payload.commentId ?? null
    });
    if (!file) {
      throw new Error("Failed to create file metadata");
    }

    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: id,
      fileRecord: file as Record<string, unknown>,
      requestId: request.headers.get("x-request-id")?.trim() || randomUUID()
    });

    return ok({ file }, 201);
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
    console.error("upload_complete_failed", { errorSummary, error });
    return serverError(errorSummary || (error instanceof Error ? error.message : "Upload failed"));
  }
}
