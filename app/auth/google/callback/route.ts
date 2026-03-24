import { parseCallbackBody, isAllowedWorkspaceEmail } from "@/lib/auth";
import { badRequest, forbidden, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const payload = parseCallbackBody(await request.json());
    if (!isAllowedWorkspaceEmail(payload.email)) {
      return forbidden("Only Workspace domain users are allowed");
    }

    return ok({
      allowed: true,
      email: payload.email,
      policy: "workspace-domain-allowlist"
    });
  } catch {
    return badRequest("Invalid auth callback payload");
  }
}
