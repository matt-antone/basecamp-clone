import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir } from "@/lib/project-storage";
import { getProject } from "@/lib/repositories";
import { DropboxStorageAdapter, isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }

    const adapter = new DropboxStorageAdapter();
    const url = await adapter.createFolderLink(getProjectStorageDir(project));
    return ok({ url });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (isTeamSelectUserRequiredError(error)) {
      return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
    }
    return serverError();
  }
}
