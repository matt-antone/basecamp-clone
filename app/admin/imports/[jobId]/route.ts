import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getImportJob } from "@/lib/imports/basecamp2-import";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireUser(request);
    const { jobId } = await params;
    const details = await getImportJob(jobId);
    if (!details.job) {
      return notFound("Import job not found");
    }
    return ok(details);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
