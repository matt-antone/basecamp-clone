import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createComment, getThread } from "@/lib/repositories";
import { z } from "zod";

const createCommentSchema = z.object({
  bodyMarkdown: z.string().min(1)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, threadId } = await params;
    const thread = await getThread(id, threadId);
    if (!thread) {
      return notFound("Thread not found");
    }

    const payload = createCommentSchema.parse(await request.json());
    const comment = await createComment({
      projectId: id,
      threadId,
      bodyMarkdown: payload.bodyMarkdown,
      authorUserId: user.id
    });

    return ok({ comment }, 201);
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
