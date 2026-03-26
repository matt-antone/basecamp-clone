import { Dropbox } from "dropbox";
import { config } from "../config";
import type { StorageAdapter } from "./types";

export class DropboxStorageAdapter implements StorageAdapter {
  private readonly baseClient: Dropbox;
  private clientPromise: Promise<Dropbox> | null = null;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly refreshToken: string | undefined;
  private readonly selectUser: string | undefined;
  private readonly selectAdmin: string | undefined;
  private readonly dropboxFetch: typeof fetch;

  constructor() {
    this.clientId = config.dropboxAppKey() ?? undefined;
    this.clientSecret = config.dropboxAppSecret() ?? undefined;
    this.refreshToken = config.dropboxRefreshToken() ?? undefined;
    this.selectUser = config.dropboxSelectUser() ?? undefined;
    this.selectAdmin = config.dropboxSelectAdmin() ?? undefined;

    this.dropboxFetch = async (...args) => {
      if (typeof globalThis.fetch !== "function") {
        throw new Error("Global fetch is unavailable in this runtime");
      }
      const response = await globalThis.fetch(...args);
      const compatibleResponse = response as Response & { buffer?: () => Promise<Buffer> };
      if (typeof compatibleResponse.buffer !== "function") {
        compatibleResponse.buffer = async () => Buffer.from(await response.arrayBuffer());
      }
      return compatibleResponse;
    };

    this.baseClient = new Dropbox({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      selectUser: this.selectUser,
      selectAdmin: this.selectAdmin,
      fetch: this.dropboxFetch
    });
  }

  private async getClient() {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    this.clientPromise = (async () => {
      const account = await this.baseClient.usersGetCurrentAccount();
      const rootInfo = account.result.root_info;
      if (rootInfo.root_namespace_id === rootInfo.home_namespace_id) {
        return this.baseClient;
      }

      return new Dropbox({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        refreshToken: this.refreshToken,
        selectUser: this.selectUser,
        selectAdmin: this.selectAdmin,
        pathRoot: JSON.stringify({ ".tag": "root", root: rootInfo.root_namespace_id }),
        fetch: this.dropboxFetch
      });
    })();

    return this.clientPromise;
  }

  async uploadInit(args: { projectStorageDir: string; filename: string; sizeBytes: number }) {
    const safeFilename = sanitizeFilename(args.filename);
    const targetPath = `${args.projectStorageDir}/uploads/${Date.now()}-${safeFilename}`;
    return {
      sessionId: crypto.randomUUID(),
      targetPath
    };
  }

  async uploadComplete(args: {
    sessionId: string;
    targetPath: string;
    filename: string;
    content: Buffer;
    mimeType: string;
  }) {
    const client = await this.getClient();
    const parentDir = getParentDir(args.targetPath);
    if (parentDir) {
      await this.ensureDirectoryChain(parentDir);
    }

    const completed = await client.filesUpload({
      path: args.targetPath,
      contents: args.content,
      autorename: true,
      mode: { ".tag": "add" },
      mute: false
    });

    return {
      fileId: completed.result.id,
      path: completed.result.path_display ?? args.targetPath,
      rev: completed.result.rev
    };
  }

  async createTemporaryDownloadLink(path: string) {
    const client = await this.getClient();
    const result = await client.filesGetTemporaryLink({ path });
    return result.result.link;
  }

  async createFolderLink(path: string) {
    const client = await this.getClient();
    const existing = await client.sharingListSharedLinks({
      path,
      direct_only: true
    });
    const existingLink = existing.result.links.find((link) => typeof link.url === "string");
    if (existingLink?.url) {
      return existingLink.url;
    }

    try {
      const created = await client.sharingCreateSharedLinkWithSettings({ path });
      return created.result.url;
    } catch (error) {
      if (isSharedLinkAlreadyExistsError(error)) {
        const retry = await client.sharingListSharedLinks({
          path,
          direct_only: true
        });
        const retryLink = retry.result.links.find((link) => typeof link.url === "string");
        if (retryLink?.url) {
          return retryLink.url;
        }
      }
      throw error;
    }
  }

  async createThumbnail(path: string, size: ThumbnailSize = "w256h256") {
    const client = await this.getClient();
    try {
      const response = await client.filesGetThumbnail({
        path,
        format: { ".tag": "jpeg" },
        size: { ".tag": size },
        mode: { ".tag": "bestfit" }
      });
      const payload = response.result as unknown as Record<string, unknown>;
      const binary = payload.fileBinary ?? payload.fileBlob;
      if (!binary) {
        throw new Error("Dropbox thumbnail response did not include binary image data");
      }
      return {
        bytes: this.ensureBuffer(binary, "Dropbox thumbnail response did not include binary image data"),
        contentType: "image/jpeg"
      };
    } catch (error) {
      if (isThumbnailUnavailableError(error) || isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async downloadFile(path: string) {
    const client = await this.getClient();
    const response = await client.filesDownload({ path });
    const payload = response.result as unknown as Record<string, unknown>;
    const binary = payload.fileBinary ?? payload.fileBlob;
    if (!binary) {
      throw new Error("Dropbox file download response did not include binary data");
    }

    const metadata = payload.metadata as Record<string, unknown> | undefined;
    const contentType =
      typeof payload.content_type === "string"
        ? payload.content_type
        : typeof metadata?.content_type === "string"
          ? metadata.content_type
          : "application/octet-stream";

    return {
      bytes: this.ensureBuffer(binary, "Dropbox file download response did not include binary data"),
      contentType
    };
  }

  async ensureProjectFolders(args: { clientSlug: string; projectFolderBaseName: string }) {
    const projectsRoot = config.dropboxProjectsRootFolder();
    const clientDir = `${projectsRoot}/${args.clientSlug}`;
    await this.ensureFolderExists(clientDir);

    const projectDir = await this.createProjectDirWithSuffix({
      clientDir,
      projectFolderBaseName: args.projectFolderBaseName
    });
    const uploadsDir = `${projectDir}/uploads`;
    await this.ensureFolderExists(uploadsDir);

    return { projectDir, uploadsDir };
  }

  async moveProjectFolder(args: { fromPath: string; toPath: string }) {
    if (args.fromPath === args.toPath) {
      return { projectDir: args.toPath };
    }

    const client = await this.getClient();
    const parentDir = getParentDir(args.toPath);
    if (parentDir) {
      await this.ensureDirectoryChain(parentDir);
    }

    await client.filesMoveV2({
      from_path: args.fromPath,
      to_path: args.toPath,
      autorename: false
    });

    return { projectDir: args.toPath };
  }

  private async createProjectDirWithSuffix(args: { clientDir: string; projectFolderBaseName: string }) {
    const maxSuffixAttempts = 200;
    for (let attempt = 0; attempt < maxSuffixAttempts; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const candidatePath = `${args.clientDir}/${args.projectFolderBaseName}${suffix}`;
      const created = await this.tryCreateFolder(candidatePath);
      if (created) {
        return candidatePath;
      }
    }
    throw new Error(`Unable to provision unique Dropbox project directory for ${args.projectFolderBaseName}`);
  }

  private async ensureFolderExists(path: string) {
    const created = await this.tryCreateFolder(path);
    if (created) {
      return;
    }
    const exists = await this.pathExists(path);
    if (!exists) {
      throw new Error(`Failed to create Dropbox folder at ${path}`);
    }
  }

  private async tryCreateFolder(path: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.filesCreateFolderV2({ path, autorename: false });
      return true;
    } catch (error) {
      if (isPathConflictError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.filesGetMetadata({ path });
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async ensureDirectoryChain(path: string) {
    const segments = path.split("/").filter(Boolean);
    if (!segments.length) return;

    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      const created = await this.tryCreateFolder(currentPath);
      if (created) {
        continue;
      }
      const exists = await this.pathExists(currentPath);
      if (!exists) {
        throw new Error(`Failed to create Dropbox folder at ${currentPath}`);
      }
    }
  }

  private ensureBuffer(value: unknown, errorMessage: string) {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    }
    if (typeof value === "string") {
      return Buffer.from(value);
    }
    throw new Error(errorMessage);
  }
}

export function mapDropboxMetadata(args: {
  projectId: string;
  uploaderUserId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  dropboxFileId: string;
  dropboxPath: string;
}) {
  return {
    project_id: args.projectId,
    uploader_user_id: args.uploaderUserId,
    filename: args.filename,
    mime_type: args.mimeType,
    size_bytes: args.sizeBytes,
    dropbox_file_id: args.dropboxFileId,
    dropbox_path: args.dropboxPath,
    checksum: args.checksum
  };
}

type ThumbnailSize = "w64h64" | "w128h128" | "w256h256" | "w480h320" | "w640h480";

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const normalized = trimmed.replace(/[\\/:*?"<>|]/g, "-");
  return normalized.length > 0 ? normalized : "file";
}

function getParentDir(path: string) {
  const normalized = path.trim();
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return normalized.slice(0, lastSlash);
}

export function getDropboxErrorSummary(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    const nestedError = obj.error;
    if (typeof nestedError === "object" && nestedError !== null) {
      const nested = nestedError as Record<string, unknown>;
      if (typeof nested.error_summary === "string") {
        return nested.error_summary;
      }
      if (typeof nested.message === "string") {
        return nested.message;
      }
      try {
        return JSON.stringify(nested);
      } catch {
        // Fall through to outer fields below.
      }
    }
    if (typeof obj.error_summary === "string") {
      return obj.error_summary;
    }
    if (typeof obj.message === "string") {
      return obj.message;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      // Fall through to String(error) below.
    }
  }
  return String(error);
}

function isPathConflictError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return summary.includes("path/conflict") || summary.includes("conflict/folder") || (status === 409 && summary.includes("conflict"));
}

function isSharedLinkAlreadyExistsError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  return summary.includes("shared_link_already_exists");
}

export function isTeamSelectUserRequiredError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  return summary.includes("dropbox-api-select-user") || summary.includes("select_user");
}

function isNotFoundError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  return summary.includes("not_found");
}

function isThumbnailUnavailableError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  return (
    summary.includes("unsupported_extension") ||
    summary.includes("unsupported_image") ||
    summary.includes("conversion_error")
  );
}
