import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth";
import { conflict, notFound, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";

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

    return Response.json(json);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    return serverError();
  }
}
