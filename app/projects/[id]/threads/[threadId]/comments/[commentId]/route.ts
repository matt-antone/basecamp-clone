import { requireUser } from "@/lib/auth";
import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { editComment, getComment } from "@/lib/repositories";
import { z } from "zod";

const editCommentSchema = z.object({
  bodyMarkdown: z.string().min(1)
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, threadId, commentId } = await params;
    const existingComment = await getComment(id, threadId, commentId);
    if (!existingComment) {
      return notFound("Comment not found");
    }
    if (existingComment.author_user_id !== user.id) {
      return forbidden("Only the comment author can edit this comment");
    }
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
