import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { badRequest, conflict, notFound, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";
import { getProjectStorageDir } from "@/lib/project-storage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

const initSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES)
});

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
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
    const parsed = initSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }

    const targetPath = `${getProjectStorageDir(project)}/uploads/${parsed.data.filename}`;
    const adapter = new DropboxStorageAdapter();
    const { uploadUrl } = await adapter.getTemporaryUploadLink({ targetPath });

    return Response.json({
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
