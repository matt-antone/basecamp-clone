import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "./config";
import { DropboxStorageAdapter, getDropboxErrorSummary } from "./storage/dropbox-adapter";

const execFile = promisify(execFileCallback);
const CANONICAL_THUMBNAIL_EDGE = 640;
const OFFICE_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf"
]);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"]);

export type ImportThumbnailAction =
  | { action: "generated"; thumbnailPath: string; message: string }
  | { action: "reused"; thumbnailPath: string; message: string }
  | { action: "skipped"; message: string };

type DropboxClientLike = {
  filesCreateFolderV2(args: { path: string; autorename: boolean }): Promise<unknown>;
  filesGetMetadata(args: { path: string }): Promise<unknown>;
  filesUpload(args: {
    path: string;
    contents: Buffer;
    autorename: boolean;
    mode: { ".tag": "overwrite" };
    mute: boolean;
  }): Promise<unknown>;
};

type CommandRunner = (command: string, args: string[]) => Promise<void>;

type ThumbnailStorageAdapter = {
  downloadFile(path: string): Promise<{ bytes: Buffer; contentType: string }>;
  getClient?: () => Promise<DropboxClientLike>;
};

export type ImportThumbnailRequest = {
  projectStorageDir: string;
  projectFileId: string;
  filename: string;
  mimeType: string;
  dropboxPath: string;
};

export function getImportedThumbnailPath(projectStorageDir: string, projectFileId: string) {
  return `${projectStorageDir}/uploads/.thumbnails/${projectFileId}.jpg`;
}

export function classifyImportThumbnailSource(args: { filename: string; mimeType: string }) {
  const mimeType = args.mimeType.toLowerCase().trim();
  const extension = getNormalizedExtension(args.filename);

  if (mimeType.startsWith("image/")) {
    return "image" as const;
  }

  if (mimeType === "application/pdf" || extension === "pdf") {
    return "pdf" as const;
  }

  if (OFFICE_MIME_TYPES.has(mimeType) || OFFICE_EXTENSIONS.has(extension)) {
    return "office" as const;
  }

  return null;
}

export function isSupportedImportThumbnailSource(args: { filename: string; mimeType: string }) {
  return classifyImportThumbnailSource(args) !== null;
}

export class ImportThumbnailService {
  constructor(
    private readonly deps: {
      storageAdapter?: ThumbnailStorageAdapter;
      commandRunner?: CommandRunner;
      tempRoot?: string;
    } = {}
  ) {}

  async ensureImportedThumbnail(args: ImportThumbnailRequest): Promise<ImportThumbnailAction> {
    const kind = classifyImportThumbnailSource(args);
    const thumbnailPath = getImportedThumbnailPath(args.projectStorageDir, args.projectFileId);

    if (!kind) {
      return {
        action: "skipped",
        message: `Thumbnail skipped for unsupported type ${args.mimeType} (${args.filename})`
      };
    }

    const client = await this.getDropboxClient();
    if (await this.pathExists(client, thumbnailPath)) {
      return {
        action: "reused",
        thumbnailPath,
        message: `Thumbnail already present at ${thumbnailPath}`
      };
    }

    const storageAdapter = this.getStorageAdapter();
    const source = await storageAdapter.downloadFile(args.dropboxPath);
    const tempDir = await mkdtemp(join(this.deps.tempRoot ?? tmpdir(), "basecamp-thumbnail-"));

    try {
      const inputPath = join(tempDir, sanitizeFileName(args.filename));
      const outputPath = join(tempDir, "thumbnail.jpg");
      const sourceBytes = source.bytes ?? Buffer.alloc(0);
      await writeFile(inputPath, sourceBytes);
      await this.ensureDropboxFolder(client, dirname(thumbnailPath));

      if (kind === "image") {
        await this.runImageMagick(inputPath, outputPath);
      } else if (kind === "pdf") {
        await this.runPdfRasterization(inputPath, outputPath);
      } else {
        const pdfPath = await this.runOfficeConversion(inputPath, tempDir);
        await this.runPdfRasterization(pdfPath, outputPath);
      }

      const thumbnailBytes = await readFile(outputPath);
      await client.filesUpload({
        path: thumbnailPath,
        contents: thumbnailBytes,
        autorename: false,
        mode: { ".tag": "overwrite" },
        mute: false
      });

      return {
        action: "generated",
        thumbnailPath,
        message: `Thumbnail generated at ${thumbnailPath}`
      };
    } catch (error) {
      throw new Error(
        `Failed to generate thumbnail for ${args.filename} (${args.dropboxPath}): ${describeError(error)}`,
        { cause: error instanceof Error ? error : undefined }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private getStorageAdapter() {
    const adapter = this.deps.storageAdapter ?? new DropboxStorageAdapter();
    return adapter;
  }

  private async getDropboxClient() {
    const adapter = this.getStorageAdapter();
    const getClient = (adapter as ThumbnailStorageAdapter).getClient;
    if (typeof getClient !== "function") {
      throw new Error("Thumbnail storage adapter does not expose a Dropbox client");
    }
    return getClient.call(adapter);
  }

  private async ensureDropboxFolder(client: DropboxClientLike, path: string) {
    const segments = path.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      currentPath += `/${segment}`;
      try {
        await client.filesCreateFolderV2({ path: currentPath, autorename: false });
      } catch (error) {
        if (!isPathConflictError(error)) {
          throw error;
        }
      }
    }
  }

  private async pathExists(client: DropboxClientLike, path: string) {
    try {
      await client.filesGetMetadata({ path });
      return true;
    } catch (error) {
      const summary = getDropboxErrorSummary(error).toLowerCase();
      if (summary.includes("not_found")) {
        return false;
      }
      throw error;
    }
  }

  private async runImageMagick(inputPath: string, outputPath: string) {
    await this.runCommand("magick", [
      inputPath,
      "-auto-orient",
      "-resize",
      `${CANONICAL_THUMBNAIL_EDGE}x${CANONICAL_THUMBNAIL_EDGE}>`,
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      outputPath
    ]);
  }

  private async runPdfRasterization(inputPath: string, outputPath: string) {
    const outputBase = outputPath.slice(0, -extname(outputPath).length);
    await this.runCommand("pdftoppm", [
      "-singlefile",
      "-jpeg",
      "-f",
      "1",
      "-scale-to",
      String(CANONICAL_THUMBNAIL_EDGE),
      inputPath,
      outputBase
    ]);
  }

  private async runOfficeConversion(inputPath: string, tempDir: string) {
    await this.runCommand("soffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      inputPath
    ]);

    const pdfPath = join(tempDir, `${basename(inputPath, extname(inputPath))}.pdf`);
    return pdfPath;
  }

  private async runCommand(command: string, args: string[]) {
    const runner = this.deps.commandRunner ?? defaultCommandRunner;
    await runner(command, args);
  }
}

export async function ensureImportedFileThumbnail(
  request: ImportThumbnailRequest,
  deps: {
    storageAdapter?: ThumbnailStorageAdapter;
    commandRunner?: CommandRunner;
    tempRoot?: string;
    workerUrl?: string | null;
    workerToken?: string | null;
    workerTimeoutMs?: number;
    fetchFn?: typeof fetch;
  } = {}
) {
  const workerUrl = deps.workerUrl ?? config.thumbnailWorkerUrl();
  if (workerUrl) {
    const workerToken = deps.workerToken ?? config.thumbnailWorkerToken();
    if (!workerToken) {
      throw new Error("THUMBNAIL_WORKER_TOKEN is required when THUMBNAIL_WORKER_URL is configured");
    }
    const timeoutMs = deps.workerTimeoutMs ?? config.thumbnailWorkerTimeoutMs();
    return callThumbnailWorker(request, {
      url: workerUrl,
      token: workerToken,
      timeoutMs,
      fetchFn: deps.fetchFn ?? globalThis.fetch
    });
  }

  const service = new ImportThumbnailService(deps);
  return service.ensureImportedThumbnail(request);
}

async function callThumbnailWorker(
  request: ImportThumbnailRequest,
  opts: { url: string; token: string; timeoutMs: number; fetchFn: typeof fetch }
): Promise<ImportThumbnailAction> {
  const endpoint = `${opts.url.replace(/\/+$/, "")}/thumbnails`;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), opts.timeoutMs);

  try {
    const response = await opts.fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`
      },
      body: JSON.stringify(request),
      signal: abortController.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Thumbnail worker request failed (${response.status}): ${text || response.statusText}`);
    }

    const parsed = text ? JSON.parse(text) : null;
    const action = parsed && typeof parsed.action === "string" ? parsed.action : null;
    const message = parsed && typeof parsed.message === "string" ? parsed.message : "";
    const thumbnailPath = parsed && typeof parsed.thumbnailPath === "string" ? parsed.thumbnailPath : undefined;

    if (action === "generated" || action === "reused") {
      return {
        action,
        thumbnailPath: thumbnailPath ?? getImportedThumbnailPath(request.projectStorageDir, request.projectFileId),
        message: message || `Thumbnail ${action} by worker`
      };
    }

    if (action === "skipped") {
      return {
        action: "skipped",
        message: message || `Thumbnail skipped for unsupported type ${request.mimeType} (${request.filename})`
      };
    }

    throw new Error("Thumbnail worker response missing a valid action");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Thumbnail worker request timed out after ${opts.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const defaultCommandRunner: CommandRunner = async (command, args) => {
  await execFile(command, args, { maxBuffer: 10 * 1024 * 1024 });
};

function getNormalizedExtension(filename: string) {
  return extname(filename).replace(/^\./, "").toLowerCase();
}

function sanitizeFileName(filename: string) {
  const trimmed = filename.trim();
  const normalized = trimmed.replace(/[\\/:*?"<>|]/g, "-");
  return normalized.length > 0 ? normalized : "file";
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return getDropboxErrorSummary(error);
}

function isPathConflictError(error: unknown) {
  const summary = getDropboxErrorSummary(error).toLowerCase();
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return summary.includes("path/conflict") || summary.includes("conflict/folder") || (status === 409 && summary.includes("conflict"));
}
