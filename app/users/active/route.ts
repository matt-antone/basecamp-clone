import { requireUser } from "@/lib/auth";
import { ok, serverError, unauthorized } from "@/lib/http";
import { listActiveUsers } from "@/lib/repositories";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const users = await listActiveUsers();
    return ok({ users });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
