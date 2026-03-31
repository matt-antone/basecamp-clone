import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { updateClientName } from "@/lib/repositories";
import { z } from "zod";

const patchClientSchema = z.object({
  name: z.string().min(1)
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const payload = patchClientSchema.parse(await request.json());
    const client = await updateClientName(id, payload.name);
    if (!client) {
      return notFound("Client not found");
    }
    return ok({ client });
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
