import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject } from "@/lib/repositories";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";
import { isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";
import slugify from "slugify";
import { z } from "zod";

const uploadInitSchema = z.object({
  filename: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }

    const payload = uploadInitSchema.parse(await request.json());
    const adapter = new DropboxStorageAdapter();
    const fallbackClientSlug =
      (typeof project.client_name === "string" && slugify(project.client_name, { lower: true, strict: true })) || "unassigned";
    const fallbackProjectSlug =
      (typeof project.project_slug === "string" && project.project_slug) ||
      (typeof project.slug === "string" && project.slug) ||
      "project";
    const fallbackProjectCode =
      (typeof project.project_code === "string" && project.project_code) || (typeof project.id === "string" ? project.id : "project");
    const projectStorageDir =
      (typeof project.storage_project_dir === "string" && project.storage_project_dir) ||
      `${config.dropboxProjectsRootFolder()}/${fallbackClientSlug}/${fallbackProjectCode}-${fallbackProjectSlug}`;

    const init = await adapter.uploadInit({
      projectStorageDir,
      filename: payload.filename,
      sizeBytes: payload.sizeBytes
    });

    return ok({
      upload: {
        sessionId: init.sessionId,
        targetPath: init.targetPath,
        mimeType: payload.mimeType
      }
    });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (isTeamSelectUserRequiredError(error)) {
      return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
    }
    return serverError();
  }
}
