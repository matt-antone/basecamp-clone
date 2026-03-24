import { Dropbox } from "dropbox";
import { config } from "../config";
import type { StorageAdapter } from "./types";

export class DropboxStorageAdapter implements StorageAdapter {
  private readonly client: Dropbox;

  constructor() {
    const dropboxFetch: typeof fetch = async (...args) => {
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

    this.client = new Dropbox({
      clientId: process.env.DROPBOX_APP_KEY,
      clientSecret: process.env.DROPBOX_APP_SECRET,
      refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
      fetch: dropboxFetch
    });
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
    contentBase64: string;
    mimeType: string;
  }) {
    const parentDir = getParentDir(args.targetPath);
    if (parentDir) {
      await this.ensureDirectoryChain(parentDir);
    }

    const content = Buffer.from(args.contentBase64, "base64");
    const completed = await this.client.filesUpload({
      path: args.targetPath,
      contents: content,
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
    const result = await this.client.filesGetTemporaryLink({ path });
    return result.result.link;
  }

  async createThumbnail(path: string, size: ThumbnailSize = "w256h256") {
    try {
      const response = await this.client.filesGetThumbnail({
        path,
        format: { ".tag": "jpeg" },
        size: { ".tag": size },
        mode: { ".tag": "bestfit" }
      });
      const payload = response.result as unknown as Record<string, unknown>;
      const binary = payload.fileBinary ?? payload.fileBlob;
      if (Buffer.isBuffer(binary)) {
        return { bytes: binary, contentType: "image/jpeg" };
      }
      if (binary instanceof ArrayBuffer) {
        return { bytes: Buffer.from(binary), contentType: "image/jpeg" };
      }
      if (typeof binary === "string") {
        return { bytes: Buffer.from(binary), contentType: "image/jpeg" };
      }
      throw new Error("Dropbox thumbnail response did not include binary image data");
    } catch (error) {
      if (isThumbnailUnavailableError(error) || isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
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
    try {
      await this.client.filesCreateFolderV2({ path, autorename: false });
      return true;
    } catch (error) {
      if (isPathConflictError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await this.client.filesGetMetadata({ path });
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

function getDropboxErrorSummary(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.error_summary === "string") {
      return obj.error_summary;
    }
    if (typeof obj.message === "string") {
      return obj.message;
    }
    const nestedError = obj.error;
    if (typeof nestedError === "object" && nestedError !== null) {
      const nested = nestedError as Record<string, unknown>;
      if (typeof nested.error_summary === "string") {
        return nested.error_summary;
      }
      if (typeof nested.message === "string") {
        return nested.message;
      }
    }
  }
  return String(error);
}

function isPathConflictError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  return summary.includes("path/conflict");
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
