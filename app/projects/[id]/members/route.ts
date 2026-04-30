import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { addProjectMember, getProject, listProjectMembers } from "@/lib/repositories";
import { z, ZodError } from "zod";

const addMemberSchema = z.object({ userId: z.string().min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    const members = await listProjectMembers(id);
    return ok({ members });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    const payload = addMemberSchema.parse(await request.json());
    await addProjectMember(id, payload.userId);
    return ok({ ok: true }, 201);
  } catch (error) {
    if (error instanceof ZodError) return badRequest("Invalid payload");
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
