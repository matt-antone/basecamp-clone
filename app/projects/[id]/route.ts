import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, updateProject } from "@/lib/repositories";
import { z } from "zod";

const patchProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().uuid(),
  tags: z.array(z.string().min(1)).max(50).optional()
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }
    return ok({ project });
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
      tags: payload.tags
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
