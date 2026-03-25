import { NextRequest, NextResponse } from "next/server";
import { parseCallbackBody, isAllowedWorkspaceEmail } from "@/lib/auth";
import {
  buildAppRedirectUrl,
  clearAuthSessionCookies,
  clearPkceStorageCookie,
  createServerSupabaseAuthClient,
  getPkceStorageFromRequest,
  setAuthSessionCookies
} from "@/lib/server-auth";
import { badRequest, forbidden, ok } from "@/lib/http";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const authError = request.nextUrl.searchParams.get("error");

  if (authError || !code) {
    const response = NextResponse.redirect(buildAppRedirectUrl(request, "/?authError=oauth-callback-failed"));
    clearAuthSessionCookies(response);
    return response;
  }

  const { client } = createServerSupabaseAuthClient(getPkceStorageFromRequest(request));
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  const response = NextResponse.redirect(buildAppRedirectUrl(request));
  clearPkceStorageCookie(response);

  if (error || !data.session || !data.user?.email || !isAllowedWorkspaceEmail(data.user.email)) {
    clearAuthSessionCookies(response);
    response.headers.set("location", buildAppRedirectUrl(request, "/?authError=workspace-domain").toString());
    return response;
  }

  setAuthSessionCookies(response, data.session);
  return response;
}

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
