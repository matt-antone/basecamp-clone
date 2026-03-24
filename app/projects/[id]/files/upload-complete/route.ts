import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createFileMetadata, getComment, getProject, getThread } from "@/lib/repositories";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";
import { mapDropboxMetadata } from "@/lib/storage/dropbox-adapter";
import { z } from "zod";

const uploadCompleteSchema = z.object({
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }

    const payload = uploadCompleteSchema.parse(await request.json());
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
      contentBase64: payload.contentBase64,
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

    return ok({ file }, 201);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    return serverError(error instanceof Error ? error.message : "Upload failed");
  }
}
