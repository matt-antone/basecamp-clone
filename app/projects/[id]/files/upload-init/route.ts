import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";
import { getProjectStorageDir } from "@/lib/project-storage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

const initSchema = z.object({
  filename: z.string().min(1).max(255).refine(
    (f) => !f.includes("/") && !f.includes("\\") && !f.startsWith("."),
    { message: "filename must not contain path separators" }
  ),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES)
});

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const { id } = await params;

    if (body.type === "blob.generate-client-token") {
      // Browser-initiated request: enforce user auth + project + archive guards
      // before issuing a Blob token. The blob.upload-completed webhook below
      // is server-to-server from Vercel Blob and authenticated by its body
      // signature (handleUpload validates internally against BLOB_READ_WRITE_TOKEN),
      // so we deliberately do not require the app's bearer token there.
      const user = await requireUser(request);
      const project = await getProject(id);
      if (!project) {
        return notFound("Project not found");
      }
      await assertClientNotArchivedForMutation(project.client_id, {
        archived: "Client is archived. Restore it before uploading files.",
        inProgress: "Client archive is in progress. File uploads are temporarily disabled."
      });

      // Capture identity in tokenPayload so audit logs can correlate the upload.
      const tokenPayload = JSON.stringify({ projectId: id, uploaderUserId: user.id });

      const json = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (_pathname, _clientPayload, _multipart) => ({
          addRandomSuffix: true,
          allowedContentTypes: undefined,
          tokenPayload
        }),
        // No-op: persistence happens in /upload-complete. handleUpload requires this callback.
        onUploadCompleted: async () => {}
      });

      return Response.json(json);
    }

    // body.type === "blob.upload-completed" — webhook from Vercel Blob.
    // No user auth here; handleUpload validates the body signature.
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Not reachable for upload-completed; satisfies the type.
        throw new Error("unexpected onBeforeGenerateToken on upload-completed callback");
      },
      onUploadCompleted: async () => {}
    });

    const targetPath = `${getProjectStorageDir(project)}/uploads/${parsed.data.filename}`;
    const adapter = new DropboxStorageAdapter();
    const { uploadUrl } = await adapter.getTemporaryUploadLink({ targetPath });

    return ok({
      uploadUrl,
      targetPath,
      requestId: randomUUID()
    });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    console.error("upload_init_failed", { error });
    return serverError();
  }
}
