import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, listProjectUserHours, setProjectUserHours } from "@/lib/repositories";
import { z } from "zod";

const patchMyHoursSchema = z.object({
  hours: z.number().nonnegative().nullable()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const payload = patchMyHoursSchema.parse(await request.json());
    const project = await getProject(id, user.id);
    if (!project) {
      return notFound("Project not found");
    }

    await setProjectUserHours({
      projectId: id,
      userId: user.id,
      hours: payload.hours
    });

    const [refreshedProject, userHours] = await Promise.all([
      getProject(id, user.id),
      listProjectUserHours(id)
    ]);
    return ok({ project: refreshedProject, userHours });
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
