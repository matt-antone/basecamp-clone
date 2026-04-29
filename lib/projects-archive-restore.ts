import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir, getProjectStorageDirForArchiveState } from "@/lib/project-storage";
import { getProject, setProjectArchivedWithStorageDir } from "@/lib/repositories";
import { DropboxStorageAdapter, isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";

export function createProjectArchiveRestoreHandler(archived: boolean) {
  return async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await requireUser(request);
      const { id } = await params;
      const project = await getProject(id);
      if (!project) {
        return notFound("Project not found");
      }

      const currentDir = getProjectStorageDir(project);
      const nextDir = getProjectStorageDirForArchiveState(project, archived);
      const adapter = new DropboxStorageAdapter();
      const moved = await adapter.moveProjectFolder({
        fromPath: currentDir,
        toPath: nextDir
      });

      const updatedProject = await setProjectArchivedWithStorageDir(id, archived, moved.projectDir);
      if (!updatedProject) {
        return notFound("Project not found");
      }

      return ok({ project: updatedProject });
    } catch (error) {
      if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
        return unauthorized(error.message);
      }
      if (isTeamSelectUserRequiredError(error)) {
        return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
      }
      return serverError();
    }
  };
}
