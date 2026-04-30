import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, removeProjectMember } from "@/lib/repositories";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    await requireUser(request);
    const { id, userId } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    try {
      await removeProjectMember(id, userId);
    } catch (error) {
      if (error instanceof Error && /last member/i.test(error.message)) {
        return badRequest(error.message);
      }
      throw error;
    }
    return ok({ ok: true });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
