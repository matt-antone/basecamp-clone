import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyRetryError, executeWithRetry } from "./retry.js";
import type { ExportFailure, FileReference, ManifestFileEntry } from "./types.js";

type DownloadFn = (
  url: string,
  timeoutMs: number
) => Promise<{ body: Buffer; contentType: string | null }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function shouldTreatAsFileLike(objectValue: Record<string, unknown>): boolean {
  return (
    typeof objectValue.download_url === "string" ||
    typeof objectValue.content_type === "string" ||
    typeof objectValue.byte_size === "number" ||
    typeof objectValue.filesize === "number" ||
    typeof objectValue.name === "string" ||
    typeof objectValue.filename === "string"
  );
}

export function collectFileReferences(
  payload: Record<string, unknown>,
  relationNodeId: string
): FileReference[] {
  const seen = new Set<string>();
  const results: FileReference[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!isObject(value)) {
      return;
    }

    const downloadUrl = [value.download_url, value.downloadUrl, value.download_href].find(
      (candidate): candidate is string => typeof candidate === "string"
    );

    if (downloadUrl && isHttpUrl(downloadUrl)) {
      const key = `download:${downloadUrl}:${relationNodeId}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          sourceUrl: downloadUrl,
          relationNodeId,
          downloadable: true,
          metadata: value
        });
      }
    }

    if (shouldTreatAsFileLike(value)) {
      const candidateUrl = [value.url, value.app_url, value.href].find(
        (candidate): candidate is string => typeof candidate === "string"
      );
      if (candidateUrl && isHttpUrl(candidateUrl) && candidateUrl !== downloadUrl) {
        const key = `meta:${candidateUrl}:${relationNodeId}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            sourceUrl: candidateUrl,
            relationNodeId,
            downloadable: false,
            metadata: value
          });
        }
      }
    }

    for (const nestedValue of Object.values(value)) {
      visit(nestedValue);
    }
  };

  visit(payload);
  return results.sort((left, right) => {
    const byUrl = left.sourceUrl.localeCompare(right.sourceUrl);
    if (byUrl !== 0) {
      return byUrl;
    }
    return left.relationNodeId.localeCompare(right.relationNodeId);
  });
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) {
    return ".bin";
  }
  const normalized = contentType.toLowerCase();
  if (normalized.includes("json")) {
    return ".json";
  }
  if (normalized.includes("pdf")) {
    return ".pdf";
  }
  if (normalized.includes("png")) {
    return ".png";
  }
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return ".jpg";
  }
  if (normalized.includes("gif")) {
    return ".gif";
  }
  if (normalized.includes("plain")) {
    return ".txt";
  }
  return ".bin";
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await worker(item);
    }
  });

  await Promise.all(workers);
}

export async function materializeFiles(
  references: FileReference[],
  outputDir: string,
  options: {
    dryRun: boolean;
    timeoutMs: number;
    maxConcurrency: number;
    download: DownloadFn;
  }
): Promise<{ files: ManifestFileEntry[]; failures: ExportFailure[] }> {
  const filesDir = path.join(outputDir, "files");
  await mkdir(filesDir, { recursive: true });

  const entries: ManifestFileEntry[] = [];
  const failures: ExportFailure[] = [];

  await runWithConcurrency(references, options.maxConcurrency, async (reference) => {
    if (!reference.downloadable) {
      entries.push({
        sourceUrl: reference.sourceUrl,
        relationNodeId: reference.relationNodeId,
        downloadable: false,
        downloaded: false,
        metadataOnly: true,
        metadata: reference.metadata
      });
      return;
    }

    if (options.dryRun) {
      entries.push({
        sourceUrl: reference.sourceUrl,
        relationNodeId: reference.relationNodeId,
        downloadable: true,
        downloaded: false,
        metadataOnly: false,
        metadata: reference.metadata
      });
      return;
    }

    try {
      const { body, contentType } = await executeWithRetry(
        () => options.download(reference.sourceUrl, options.timeoutMs),
        {
          maxAttempts: 4
        }
      );

      const digest = sha256(body);
      const extension = extensionFromContentType(contentType);
      const filename = `${digest}${extension}`;
      const absolutePath = path.join(filesDir, filename);
      const relativePath = path.join("files", filename);

      let shouldWrite = true;
      try {
        await stat(absolutePath);
        const existing = await readFile(absolutePath);
        if (sha256(existing) === digest) {
          shouldWrite = false;
        }
      } catch {
        shouldWrite = true;
      }

      if (shouldWrite) {
        await writeFile(absolutePath, body);
      }

      entries.push({
        sourceUrl: reference.sourceUrl,
        relationNodeId: reference.relationNodeId,
        downloadable: true,
        downloaded: true,
        metadataOnly: false,
        sha256: digest,
        size: body.length,
        storedPath: relativePath,
        contentType: contentType ?? undefined,
        metadata: reference.metadata
      });
    } catch (error) {
      const classification = classifyRetryError(error);
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        stage: "download",
        resource: "files",
        status: classification.status,
        retryable: classification.retryable,
        message,
        at: new Date().toISOString(),
        details: {
          sourceUrl: reference.sourceUrl,
          relationNodeId: reference.relationNodeId
        }
      });
      entries.push({
        sourceUrl: reference.sourceUrl,
        relationNodeId: reference.relationNodeId,
        downloadable: true,
        downloaded: false,
        metadataOnly: false,
        metadata: reference.metadata
      });
    }
  });

  entries.sort((left, right) => {
    const byUrl = left.sourceUrl.localeCompare(right.sourceUrl);
    if (byUrl !== 0) {
      return byUrl;
    }
    return left.relationNodeId.localeCompare(right.relationNodeId);
  });

  return { files: entries, failures };
}
