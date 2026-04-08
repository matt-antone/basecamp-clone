export class DropboxAuthError extends Error {
  constructor() {
    super("Dropbox authentication failed");
    this.name = "DropboxAuthError";
  }
}

export class DropboxConfigError extends Error {
  constructor() {
    super("Dropbox credentials missing");
    this.name = "DropboxConfigError";
  }
}

export class DropboxStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropboxStorageError";
  }
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export function _resetTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

function getConfig() {
  const clientId = Deno.env.get("DROPBOX_CLIENT_ID");
  const clientSecret = Deno.env.get("DROPBOX_CLIENT_SECRET");
  const refreshToken = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new DropboxConfigError();
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    selectUser: Deno.env.get("DROPBOX_SELECT_USER"),
    selectAdmin: Deno.env.get("DROPBOX_SELECT_ADMIN"),
  };
}

export async function _refreshAccessToken(): Promise<string> {
  const config = getConfig();

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new DropboxAuthError();
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}

function teamHeaders(config: ReturnType<typeof getConfig>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.selectUser) headers["Dropbox-API-Select-User"] = config.selectUser;
  if (config.selectAdmin) headers["Dropbox-API-Select-Admin"] = config.selectAdmin;
  return headers;
}

export async function getTemporaryLink(pathOrId: string): Promise<string> {
  const config = getConfig();
  const token = await _refreshAccessToken();

  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...teamHeaders(config),
    },
    body: JSON.stringify({ path: pathOrId }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 && text.includes("not_found")) {
      throw new DropboxStorageError("File not found in storage");
    }
    if (res.status === 429) {
      throw new DropboxStorageError("Storage rate limited, try again later");
    }
    throw new DropboxStorageError("Storage error");
  }

  const data = await res.json();
  return data.link;
}

export async function downloadFile(
  pathOrId: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const config = getConfig();
  const token = await _refreshAccessToken();

  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: pathOrId }),
      ...teamHeaders(config),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 && text.includes("not_found")) {
      throw new DropboxStorageError("File not found in storage");
    }
    if (res.status === 429) {
      throw new DropboxStorageError("Storage rate limited, try again later");
    }
    throw new DropboxStorageError("Storage error");
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  return { bytes, contentType };
}
