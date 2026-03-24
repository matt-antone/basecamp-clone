import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getProject } from "@/lib/repositories";
import { DropboxStorageAdapter, isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";
import slugify from "slugify";

function getProjectStorageDir(project: Record<string, unknown>) {
  if (typeof project.storage_project_dir === "string" && project.storage_project_dir) {
    return project.storage_project_dir;
  }

  const fallbackClientSlug =
    (typeof project.client_name === "string" && slugify(project.client_name, { lower: true, strict: true })) || "unassigned";
  const fallbackProjectSlug =
    (typeof project.project_slug === "string" && project.project_slug) ||
    (typeof project.slug === "string" && project.slug) ||
    "project";
  const fallbackProjectCode =
    (typeof project.project_code === "string" && project.project_code) ||
    (typeof project.id === "string" ? project.id : "project");

  return `${config.dropboxProjectsRootFolder()}/${fallbackClientSlug}/${fallbackProjectCode}-${fallbackProjectSlug}`;
}

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
    return Response.redirect(url, 302);
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
