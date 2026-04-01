import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, listProjectUserHours, updateProject } from "@/lib/repositories";
import { z } from "zod";

const patchProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().uuid(),
  tags: z.array(z.string().min(1)).max(50).optional(),
  deadline: z.string().date().optional().nullable(),
  requestor: z.string().optional().nullable(),
  pm_note: z.string().max(256).optional().nullable()
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const [project, userHours] = await Promise.all([getProject(id, user.id), listProjectUserHours(id)]);
    if (!project) {
      return notFound("Project not found");
    }
    return ok({ project, userHours });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const payload = patchProjectSchema.parse(await request.json());
    const project = await updateProject({
      id,
      name: payload.name,
      description: payload.description,
      clientId: payload.clientId,
      tags: payload.tags,
      deadline: payload.deadline,
      requestor: payload.requestor,
      pm_note: payload.pm_note
    });
    if (!project) {
      return notFound("Project not found");
    }
    return ok({ project });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (error instanceof Error && /client/i.test(error.message)) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
