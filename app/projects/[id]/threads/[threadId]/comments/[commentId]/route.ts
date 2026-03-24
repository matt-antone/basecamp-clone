import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { editComment } from "@/lib/repositories";
import { z } from "zod";

const editCommentSchema = z.object({
  bodyMarkdown: z.string().min(1)
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> }
) {
  try {
    await requireUser(request);
    const { id, threadId, commentId } = await params;
    const payload = editCommentSchema.parse(await request.json());
    const comment = await editComment({
      projectId: id,
      threadId,
      commentId,
      bodyMarkdown: payload.bodyMarkdown
    });
    if (!comment) {
      return notFound("Comment not found");
    }
    return ok({ comment });
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
