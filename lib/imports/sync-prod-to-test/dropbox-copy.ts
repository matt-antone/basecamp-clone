// lib/imports/sync-prod-to-test/dropbox-copy.ts
// Copy files within the team-space Dropbox account, mirroring the path-root
// resolution used by DropboxStorageAdapter (the team root namespace must be
// set via pathRoot or filesCopyV2 will look in the user's home instead).
import { Dropbox } from "dropbox";
import { config } from "../../config-core";

const PROD_ROOT = "/Projects";
const TEST_ROOT = "/Projects-test";

export interface CopyResult {
  ok: boolean;
  newPath: string | null;
  newFileId: string | null;
  newSize: number | null;
  errorMessage: string | null;
}

const dropboxFetch = async (...args: Parameters<typeof fetch>) => {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("Global fetch is unavailable in this runtime");
  }
  const response = await globalThis.fetch(...args);
  const compat = response as Response & { buffer?: () => Promise<Buffer> };
  if (typeof compat.buffer !== "function") {
    compat.buffer = async () => Buffer.from(await response.arrayBuffer());
  }
  return compat;
};

let teamClientPromise: Promise<Dropbox> | null = null;

function getTeamClient(): Promise<Dropbox> {
  if (teamClientPromise) return teamClientPromise;
  teamClientPromise = (async () => {
    const opts = {
      clientId: config.dropboxAppKey() ?? undefined,
      clientSecret: config.dropboxAppSecret() ?? undefined,
      refreshToken: config.dropboxRefreshToken() ?? undefined,
      selectUser: config.dropboxSelectUser() ?? undefined,
      selectAdmin: config.dropboxSelectAdmin() ?? undefined,
      fetch: dropboxFetch,
    };
    const baseClient = new Dropbox(opts);
    const account = await baseClient.usersGetCurrentAccount();
    const rootInfo = account.result.root_info;
    if (rootInfo.root_namespace_id === rootInfo.home_namespace_id) {
      return baseClient;
    }
    return new Dropbox({
      ...opts,
      pathRoot: JSON.stringify({ ".tag": "root", root: rootInfo.root_namespace_id }),
    });
  })();
  return teamClientPromise;
}

export async function copyProdFileToTestRoot(prodPath: string): Promise<CopyResult> {
  if (!prodPath.startsWith(PROD_ROOT + "/")) {
    return {
      ok: false,
      newPath: null,
      newFileId: null,
      newSize: null,
      errorMessage: `path '${prodPath}' is not under ${PROD_ROOT}`,
    };
  }

  const newPath = TEST_ROOT + prodPath.slice(PROD_ROOT.length);

  try {
    const dbx = await getTeamClient();
    const res = await dbx.filesCopyV2({
      from_path: prodPath,
      to_path: newPath,
      allow_shared_folder: true,
      autorename: true,
      allow_ownership_transfer: false,
    });

    const meta = res.result.metadata as {
      ".tag": string;
      id?: string;
      path_display?: string;
      size?: number;
    };

    if (meta[".tag"] !== "file") {
      return {
        ok: false,
        newPath: null,
        newFileId: null,
        newSize: null,
        errorMessage: `unexpected metadata tag '${meta[".tag"]}'`,
      };
    }

    return {
      ok: true,
      newPath: meta.path_display ?? newPath,
      newFileId: meta.id ?? null,
      newSize: typeof meta.size === "number" ? meta.size : null,
      errorMessage: null,
    };
  } catch (e) {
    const summary =
      (e as { error?: { error_summary?: string } })?.error?.error_summary ?? null;
    return {
      ok: false,
      newPath: null,
      newFileId: null,
      newSize: null,
      errorMessage: summary ? `${summary} (${(e as Error).message})` : (e as Error).message,
    };
  }
}
