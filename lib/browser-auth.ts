"use client";

type BrowserAuthUser = {
  id: string;
  email?: string;
};

type BrowserAuthSession = {
  accessToken: string | null;
  domainAllowed: boolean;
  googleAvatarUrl: string;
  status: string;
  user: BrowserAuthUser | null;
};

export async function fetchAuthSession(): Promise<BrowserAuthSession> {
  const response = await fetch("/auth/session", {
    cache: "no-store",
    credentials: "same-origin"
  });

  const data = (await response.json().catch(() => ({}))) as Partial<BrowserAuthSession>;

  return {
    accessToken: typeof data.accessToken === "string" ? data.accessToken : null,
    domainAllowed: data.domainAllowed === true,
    googleAvatarUrl: typeof data.googleAvatarUrl === "string" ? data.googleAvatarUrl : "",
    status: typeof data.status === "string" ? data.status : "Unable to load session",
    user:
      data.user && typeof data.user === "object" && typeof data.user.id === "string"
        ? {
            id: data.user.id,
            email: typeof data.user.email === "string" ? data.user.email : undefined
          }
        : null
  };
}

export async function ensureAccessToken(
  currentToken: string | null,
  onToken?: (token: string | null) => void
): Promise<string> {
  if (currentToken) {
    return currentToken;
  }

  const session = await fetchAuthSession();
  onToken?.(session.accessToken);
  if (!session.accessToken) {
    throw new Error(session.status || "Please sign in");
  }

  return session.accessToken;
}

type AuthedFetchOptions = {
  accessToken: string | null;
  onToken?: (token: string | null) => void;
  path: string;
  init?: RequestInit;
};

function responseErrorMessage(data: Record<string, unknown> | null, status: number) {
  return typeof data?.error === "string" ? data.error : `Request failed: ${status}`;
}

async function readJsonResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

export async function authedJsonFetch(options: AuthedFetchOptions) {
  let accessToken = await ensureAccessToken(options.accessToken, options.onToken);

  const send = (token: string) =>
    fetch(options.path, {
      ...options.init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.init?.headers ?? {})
      }
    });

  let response = await send(accessToken);
  if (response.status === 401) {
    accessToken = await ensureAccessToken(null, options.onToken);
    response = await send(accessToken);
  }

  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(responseErrorMessage(data, response.status));
  }

  return {
    accessToken,
    data
  };
}

