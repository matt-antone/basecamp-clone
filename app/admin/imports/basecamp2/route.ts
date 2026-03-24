import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { createImportJob, runBasecampImport, type BasecampImportPayload } from "@/lib/imports/basecamp2-import";

export async function POST(request: Request) {
  try {
    await requireUser(request);
    const payload = (await request.json()) as BasecampImportPayload;
    const job = await createImportJob({ mode: "full" });
    await runBasecampImport(job.id, payload);
    return ok({ jobId: job.id }, 202);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof SyntaxError) {
      return badRequest("Invalid JSON payload");
    }
    return serverError();
  }
}
