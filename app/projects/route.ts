import { requireUser } from "@/lib/auth";
import { badRequest, serverError, unauthorized, ok } from "@/lib/http";
import { createProject, deleteProjectById, listProjects, setProjectStorageDir } from "@/lib/repositories";
import { DropboxStorageAdapter, getDropboxErrorSummary, isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().uuid(),
  tags: z.array(z.string().min(1)).max(50).optional(),
  deadline: z.string().date().optional().nullable(),
  requestor: z.string().optional().nullable()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") !== "false";
    const projects = await listProjects(includeArchived);
    return ok({ projects });
  } catch (error) {
    console.error("project_create_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const payload = createProjectSchema.parse(await request.json());
    const createdProject = await createProject({
      name: payload.name,
      description: payload.description,
      createdBy: user.id,
      clientId: payload.clientId,
      tags: payload.tags,
      deadline: payload.deadline,
      requestor: payload.requestor
    });

    const adapter = new DropboxStorageAdapter();
    try {
      const projectFolderBaseName = `${createdProject.project_code}-${createdProject.project_slug}`;
      const provisioned = await adapter.ensureProjectFolders({
        clientSlug: createdProject.client_slug,
        projectFolderBaseName
      });
      const project = await setProjectStorageDir(createdProject.id, provisioned.projectDir);
      return ok({ project: project ?? createdProject }, 201);
    } catch (error) {
      const dropboxSummary = getDropboxErrorSummary(error);

      try {
        await deleteProjectById(createdProject.id);
      } catch (cleanupError) {
        console.error("project_create_cleanup_failed", {
          projectId: createdProject.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }

      console.error("project_storage_provision_failed", {
        projectId: createdProject.id,
        clientSlug: createdProject.client_slug,
        projectCode: createdProject.project_code,
        projectSlug: createdProject.project_slug,
        error: dropboxSummary
      });

      if (isTeamSelectUserRequiredError(error)) {
        return serverError("Project creation failed because Dropbox requires DROPBOX_SELECT_USER or DROPBOX_SELECT_ADMIN for this team token.");
      }

      return serverError(`Project creation failed while provisioning Dropbox folders: ${dropboxSummary}`);
    }
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && /client|project name/i.test(error.message)) {
      return badRequest(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
