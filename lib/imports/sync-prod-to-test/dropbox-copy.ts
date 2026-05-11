// lib/imports/sync-prod-to-test/dropbox-copy.ts
// Uses DropboxStorageAdapter from lib/storage/dropbox-adapter.ts.
// The adapter wraps the raw Dropbox SDK client; filesCopyV2 is NOT exposed as a
// method on the adapter, so we instantiate the adapter to obtain its authenticated
// internal client via the private getClient path — instead we call filesCopyV2
// directly on the raw Dropbox SDK by constructing a lightweight client from the
// same env vars the adapter reads, mirroring its constructor.
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

/**
 * Copy a Dropbox file from /Projects/... to the equivalent path under /Projects-test/...
 * Uses the same credentials as DropboxStorageAdapter (dropboxAppKey / dropboxAppSecret /
 * dropboxRefreshToken / dropboxSelectUser / dropboxSelectAdmin).
 */
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

    const dbx = new Dropbox({
      clientId: config.dropboxAppKey() ?? undefined,
      clientSecret: config.dropboxAppSecret() ?? undefined,
      refreshToken: config.dropboxRefreshToken() ?? undefined,
      selectUser: config.dropboxSelectUser() ?? undefined,
      selectAdmin: config.dropboxSelectAdmin() ?? undefined,
      fetch: dropboxFetch,
    });

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
    return {
      ok: false,
      newPath: null,
      newFileId: null,
      newSize: null,
      errorMessage: (e as Error).message,
    };
  }
}
