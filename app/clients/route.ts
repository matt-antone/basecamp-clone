import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { createClient, listClients } from "@/lib/repositories";
import { z } from "zod";

const createClientSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(16).regex(/^[A-Za-z0-9_-]+$/)
});

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const clients = await listClients();
    return ok({ clients });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(request);
    const payload = createClientSchema.parse(await request.json());
    const client = await createClient({ name: payload.name, code: payload.code });
    return ok({ client }, 201);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return badRequest("Client code already exists");
    }
    return serverError();
  }
}
