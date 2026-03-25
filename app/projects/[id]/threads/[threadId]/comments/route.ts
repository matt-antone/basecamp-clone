import { requireUser } from "@/lib/auth";
import { createCommentExcerpt, sendCommentCreatedEmail } from "@/lib/mailer";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createComment, getProject, getThread, getUserProfileById, listNotificationRecipients } from "@/lib/repositories";
import { z } from "zod";

const createCommentSchema = z.object({
  bodyMarkdown: z.string().min(1)
});

function getDisplayName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const firstName = (profile.first_name ?? profile.firstName ?? "").trim();
  const lastName = (profile.last_name ?? profile.lastName ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || profile.email || "Teammate";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, threadId } = await params;
    const [project, threadResult] = await Promise.all([getProject(id), getThread(id, threadId)]);
    const thread = threadResult as { id: string; title: string } | null;
    if (!project) {
      return notFound("Project not found");
    }
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

    let recipientCount = 0;
    try {
      const [actorProfile, recipients] = await Promise.all([
        getUserProfileById(user.id),
        listNotificationRecipients(user.id)
      ]);
      recipientCount = recipients.length;

      if (recipients.length > 0) {
        const threadUrl = new URL(`/${id}/${threadId}`, request.url).toString();
        await sendCommentCreatedEmail({
          recipients: recipients.map((recipient) => ({
            email: recipient.email,
            name: getDisplayName(recipient)
          })),
          actor: {
            name: getDisplayName({ ...(actorProfile ?? {}), email: user.email }),
            email: user.email
          },
          project: {
            id: project.id,
            name: project.name
          },
          thread: {
            id: threadId,
            title: thread.title
          },
          comment: {
            id: comment.id,
            excerpt: createCommentExcerpt(payload.bodyMarkdown)
          },
          threadUrl
        });
      }
    } catch (error) {
      console.error("transactional_email_failed", {
        eventType: "comment_created",
        actorId: user.id,
        projectId: id,
        threadId,
        recipientCount,
        error: error instanceof Error ? error.message : String(error)
      });
    }

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
