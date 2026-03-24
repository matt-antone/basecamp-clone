#!/usr/bin/env node

const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

function getArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function printUsage() {
  console.log(`\nGenerate Dropbox refresh token (offline access)\n\nUsage:\n  node scripts/get-dropbox-refresh-token.mjs --code <auth_code> --app-key <app_key> --app-secret <app_secret>\n\nAlternative env vars:\n  DROPBOX_APP_KEY\n  DROPBOX_APP_SECRET\n\nHow to get auth code:\n  1) Open in browser:\n     https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code\n  2) Approve the app and copy the 'code' from redirect URL.\n`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const code = getArg("code");
  const appKey = getArg("app-key") ?? process.env.DROPBOX_APP_KEY;
  const appSecret = getArg("app-secret") ?? process.env.DROPBOX_APP_SECRET;

  if (!code || !appKey || !appSecret) {
    console.error("Missing required values: --code, app key, and app secret.");
    printUsage();
    process.exit(1);
  }

  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    client_secret: appSecret
  });

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Dropbox token exchange failed:");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  if (!data.refresh_token) {
    console.error("No refresh_token in response:");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("\nSuccess. Add this to your .env/.env.local:\n");
  console.log(`DROPBOX_REFRESH_TOKEN=${data.refresh_token}`);

  if (data.access_token) {
    console.log("\nNote: access_token is short-lived; use refresh_token for app config.");
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
