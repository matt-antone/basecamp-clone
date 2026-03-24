import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createThread, getProject, listThreads } from "@/lib/repositories";
import { z } from "zod";

const createThreadSchema = z.object({
  title: z.string().min(1),
  bodyMarkdown: z.string().min(1)
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }
    const threads = await listThreads(id);
    return ok({ threads });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }

    const payload = createThreadSchema.parse(await request.json());
    const thread = await createThread({
      projectId: id,
      title: payload.title,
      bodyMarkdown: payload.bodyMarkdown,
      authorUserId: user.id
    });

    return ok({ thread }, 201);
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
