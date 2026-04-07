import { requireUser } from "@/lib/auth";
import { createCommentExcerpt, sendCommentCreatedEmail } from "@/lib/mailer";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import {
  assertClientNotArchivedForMutation,
  createComment,
  getProject,
  getThread,
  getUserProfileById,
  listNotificationRecipients
} from "@/lib/repositories";
import { z } from "zod";

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

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
    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before posting comments.",
      inProgress: "Client archive is in progress. New comments are temporarily disabled."
    });

    const payload = createCommentSchema.parse(await request.json());
    const comment = await createComment({
      projectId: id,
      threadId,
      bodyMarkdown: payload.bodyMarkdown,
      authorUserId: user.id
    });

    let recipientCount = 0;
    let emailBranch: "not_attempted" | "attempted" | "skipped_no_recipients" | "failed" = "not_attempted";
    let mailResult: Awaited<ReturnType<typeof sendCommentCreatedEmail>> | null = null;
    let emailError: string | null = null;

    try {
      const [actorProfile, recipients] = await Promise.all([
        getUserProfileById(user.id),
        listNotificationRecipients(user.id)
      ]);
      recipientCount = recipients.length;

      if (recipients.length === 0) {
        emailBranch = "skipped_no_recipients";
        console.warn("transactional_email_skipped", {
          eventType: "comment_created",
          actorId: user.id,
          projectId: id,
          threadId,
          reason: "no_recipients"
        });
      } else {
        const threadUrl = new URL(`/${id}/${threadId}`, request.url).toString();
        emailBranch = "attempted";
        console.info("transactional_email_attempt", {
          eventType: "comment_created",
          actorId: user.id,
          projectId: id,
          threadId,
          recipientCount
        });

        mailResult = await sendCommentCreatedEmail({
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

        console.info("transactional_email_result", {
          eventType: "comment_created",
          actorId: user.id,
          projectId: id,
          threadId,
          recipientCount,
          mailResult
        });
      }
    } catch (error) {
      emailBranch = "failed";
      emailError = error instanceof Error ? error.message : String(error);
      console.error("transactional_email_failed", {
        eventType: "comment_created",
        actorId: user.id,
        projectId: id,
        threadId,
        recipientCount,
        error: emailError
      });
    }

    console.error("transactional_email_audit", {
      eventType: "comment_created",
      actorId: user.id,
      projectId: id,
      threadId,
      recipientCount,
      emailBranch,
      mailResult,
      emailError
    });

    return ok({ comment }, 201);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
