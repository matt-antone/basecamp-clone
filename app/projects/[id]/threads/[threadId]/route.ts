import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getThread } from "@/lib/repositories";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    await requireUser(request);
    const { id, threadId } = await params;
    const thread = await getThread(id, threadId);
    if (!thread) {
      return notFound("Thread not found");
    }
    return ok({ thread });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
