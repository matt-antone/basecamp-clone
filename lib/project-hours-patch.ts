import { requireUser } from "@/lib/auth";
import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, listProjectUserHours, setProjectUserHours } from "@/lib/repositories";
import { ZodError } from "zod";

type ResolvedHours = {
  userId: string;
  hours: number | null;
};

type ProjectHoursPatchOptions = {
  /** May throw ZodError; caught by handler and mapped to 400. */
  resolveUserAndHours: (
    request: Request,
    authUser: { id: string }
  ) => Promise<ResolvedHours>;
  requireArchived: boolean;
};

export function createProjectHoursPatchHandler(options: ProjectHoursPatchOptions) {
  return async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const user = await requireUser(request);
      const { id } = await params;
      const project = await getProject(id, user.id);
      if (!project) {
        return notFound("Project not found");
      }
      if (options.requireArchived && !project.archived) {
        return forbidden("Archived hours can only be edited on archived projects");
      }

      const { userId, hours } = await options.resolveUserAndHours(request, user);

      await setProjectUserHours({
        projectId: id,
        userId,
        hours
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
      if (error instanceof ZodError) {
        return badRequest(error.message);
      }
      return serverError();
    }
  };
}
