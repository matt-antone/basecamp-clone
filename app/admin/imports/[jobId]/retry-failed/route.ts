import { requireUser } from "@/lib/auth";
import { ok, serverError, unauthorized } from "@/lib/http";
import { retryFailedImport } from "@/lib/imports/basecamp2-import";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireUser(request);
    const { jobId } = await params;
    const result = await retryFailedImport(jobId);
    return ok(result);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
