import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { setProjectStatus } from "@/lib/repositories";
import { z } from "zod";

const setProjectStatusSchema = z.object({
  status: z.enum(["new", "in_progress", "blocked", "complete"])
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const payload = setProjectStatusSchema.parse(await request.json());
    const project = await setProjectStatus(id, payload.status);
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
    return serverError();
  }
}
