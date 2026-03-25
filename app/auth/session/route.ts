import { NextRequest, NextResponse } from "next/server";
import { isAllowedWorkspaceEmail } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  authSessionPayload,
  clearAuthSessionCookies,
  createServerSupabaseAuthClient,
  setAuthSessionCookies
} from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value ?? null;

  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      authSessionPayload({
        accessToken: null,
        domainAllowed: false,
        status: "Please sign in",
        user: null
      })
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  let nextAccessToken = accessToken;
  let currentUser = null;

  if (accessToken) {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (!error && data.user?.email) {
      currentUser = data.user;
    }
  }

  if (!currentUser && refreshToken) {
    const { client } = createServerSupabaseAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });

    if (!error && data.session?.access_token && data.user?.email) {
      nextAccessToken = data.session.access_token;
      currentUser = data.user;

      const response = NextResponse.json(
        authSessionPayload({
          accessToken: nextAccessToken,
          domainAllowed: true,
          status: `Signed in as ${data.user.email}`,
          user: data.user
        })
      );
      setAuthSessionCookies(response, data.session);
      return response;
    }
  }

  if (!currentUser?.email) {
    const response = NextResponse.json(
      authSessionPayload({
        accessToken: null,
        domainAllowed: false,
        status: "Please sign in",
        user: null
      })
    );
    clearAuthSessionCookies(response);
    return response;
  }

  if (!isAllowedWorkspaceEmail(currentUser.email)) {
    const response = NextResponse.json(
      authSessionPayload({
        accessToken: null,
        domainAllowed: false,
        status: "Blocked: non-workspace account",
        user: null
      }),
      { status: 403 }
    );
    clearAuthSessionCookies(response);
    return response;
  }

  return NextResponse.json(
    authSessionPayload({
      accessToken: nextAccessToken,
      domainAllowed: true,
      status: `Signed in as ${currentUser.email}`,
      user: currentUser
    })
  );
}
