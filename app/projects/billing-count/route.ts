import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { countBillingStageProjects } from "@/lib/billing-stage-count";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);

    const clientIdRaw = url.searchParams.get("clientId");
    const clientIdTrimmed = clientIdRaw?.trim() ?? "";
    let clientId: string | null = null;
    if (clientIdTrimmed.length > 0) {
      const parsed = z.string().uuid().safeParse(clientIdTrimmed);
      if (!parsed.success) {
        return badRequest("Invalid clientId");
      }
      clientId = parsed.data;
    }

    const search = (url.searchParams.get("search") ?? "").trim();
    const count = await countBillingStageProjects({
      clientId,
      search: search.length > 0 ? search : undefined
    });

    return ok({ count });
  } catch (error) {
    console.error("projects_billing_count_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
