import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { setProjectArchived } from "@/lib/repositories";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await setProjectArchived(id, false);
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
