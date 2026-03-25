import { NextRequest, NextResponse } from "next/server";
import { buildGoogleCallbackUrl, createServerSupabaseAuthClient, setPkceStorageCookie } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const { client, readPkceStorage } = createServerSupabaseAuthClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: buildGoogleCallbackUrl(request),
      skipBrowserRedirect: true
    }
  });

  if (error || !data?.url) {
    return NextResponse.redirect(new URL("/?authError=oauth-start-failed", request.url));
  }

  const response = NextResponse.redirect(data.url);
  setPkceStorageCookie(response, readPkceStorage());
  return response;
}
