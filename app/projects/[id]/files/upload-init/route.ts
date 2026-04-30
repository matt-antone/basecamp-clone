import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth";
import { conflict, notFound, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }
    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before uploading files.",
      inProgress: "Client archive is in progress. File uploads are temporarily disabled."
    });

    const body = (await request.json()) as HandleUploadBody;

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, _clientPayload, _multipart) => ({
        addRandomSuffix: true,
        allowedContentTypes: undefined,
        tokenPayload: JSON.stringify({ projectId: id, uploaderUserId: user.id, pathname })
      }),
      // No-op: persistence happens in /upload-complete (Task 5). handleUpload requires this callback.
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
