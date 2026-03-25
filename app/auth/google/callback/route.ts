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

function redirectWithAuthError(request: NextRequest, code: string) {
  const response = NextResponse.redirect(buildAppRedirectUrl(request, `/?authError=${code}`));
  clearAuthSessionCookies(response);
  clearPkceStorageCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const authError = request.nextUrl.searchParams.get("error");

  if (authError || !code) {
    return redirectWithAuthError(request, "oauth-callback-failed");
  }

  const { client } = createServerSupabaseAuthClient(getPkceStorageFromRequest(request));
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  const response = NextResponse.redirect(buildAppRedirectUrl(request));
  clearPkceStorageCookie(response);

  if (error) {
    console.error("Google OAuth session exchange failed", error);
    return redirectWithAuthError(request, "oauth-session-exchange");
  }

  if (!data.session) {
    console.error("Google OAuth callback completed without a session");
    return redirectWithAuthError(request, "oauth-session-missing");
  }

  if (!data.user?.email) {
    console.error("Google OAuth callback completed without a user email");
    return redirectWithAuthError(request, "oauth-missing-email");
  }

  if (!isAllowedWorkspaceEmail(data.user.email)) {
    return redirectWithAuthError(request, "workspace-domain");
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
