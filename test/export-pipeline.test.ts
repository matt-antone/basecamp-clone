import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CheckpointStore } from "../src/export/checkpoint.js";
import {
  runValidation,
  validateReferentialIntegrity,
  type ManifestFileRecord
} from "../src/export/validation.js";
import {
  classifyRetryError,
  executeWithRetry,
  type RetryClassification
} from "../src/export/retry.js";
import { runExportPipeline } from "../src/export/pipeline.js";
import type { BasecampClient } from "../src/basecamp/client.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("export checkpoint + retry + validation", () => {
  it("persists checkpoint atomically and supports resume after interruption", async () => {
    const outputDir = createTempDir("export-checkpoint-");
    const checkpointPath = path.join(outputDir, "checkpoint.json");
    const store = new CheckpointStore(checkpointPath);

    await store.markCompleted("project:10:topics", { page: 2 });

    const loaded = await store.load();
    expect(loaded?.completed["project:10:topics"]?.metadata).toEqual({ page: 2 });

    await writeFile(`${checkpointPath}.tmp`, "{\"corrupt\":true}", "utf8");

    const resumed = await store.load();
    expect(resumed?.completed["project:10:topics"]?.key).toBe("project:10:topics");

    const persistedRaw = await readFile(checkpointPath, "utf8");
    expect(() => JSON.parse(persistedRaw)).not.toThrow();
  });

  it("classifies retryable errors and retries with backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    let callCount = 0;
    const result = await executeWithRetry(
      async () => {
        callCount += 1;
        if (callCount < 3) {
          const err = new Error("rate limited") as Error & {
            status: number;
            retryAfterSeconds: number;
          };
          err.status = 429;
          err.retryAfterSeconds = 0;
          throw err;
        }

        return "ok";
      },
      {
        maxAttempts: 4,
        random: () => 0.5,
        sleep,
        onRetry
      }
    );

    expect(result).toBe("ok");
    expect(callCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);

    const classification: RetryClassification = classifyRetryError({ status: 503 });
    expect(classification.className).toBe("server_error");
    expect(classification.retryable).toBe(true);
  });

  it("enforces referential, file integrity, completeness, and threshold gates", async () => {
    const outputDir = createTempDir("export-validate-");
    await mkdir(path.join(outputDir, "files"), { recursive: true });

    const goodContent = Buffer.from("abc123");
    const goodSha = createHash("sha256").update(goodContent).digest("hex");
    await writeFile(path.join(outputDir, "files/good.bin"), goodContent);

    const files: ManifestFileRecord[] = [
      {
        nodeId: "upload:1",
        relativePath: "files/good.bin",
        sha256: goodSha,
        size: goodContent.length,
        downloaded: true
      },
      {
        nodeId: "upload:2",
        relativePath: "files/missing.bin",
        sha256: "deadbeef",
        size: 10,
        downloaded: true
      }
    ];
    const missingFile = files[1];

    const nodes = [
      { id: "project:10", type: "project", status: "active" },
      { id: "message:1", type: "message", status: "active" }
    ];
    const edges = [
      { type: "IN_PROJECT", from: "message:1", to: "project:10" },
      { type: "CREATED_BY", from: "message:1", to: "person:404" }
    ];

    const unresolved = validateReferentialIntegrity(nodes, edges);
    expect(unresolved).toHaveLength(1);

    const report = await runValidation({
      outputDir,
      nodes,
      edges,
      files,
      completeness: {
        expectedByTypeAndStatus: {
          "project:active": 1,
          "message:active": 2
        },
        actualByTypeAndStatus: {
          "project:active": 1,
          "message:active": 1
        }
      },
      maxMissingFiles: 0
    });

    expect(report.passed).toBe(false);
    expect(report.metrics.unresolvedEdgeCount).toBe(1);
    expect(report.metrics.missingFileCount).toBe(1);
    expect(report.metrics.completenessMismatchCount).toBe(1);
    expect(report.errors.some((error) => error.includes("threshold"))).toBe(true);

    const warningOnly = await runValidation({
      outputDir,
      nodes: [
        { id: "project:10", type: "project", status: "active" }
      ],
      edges: [],
      files: missingFile ? [missingFile] : [],
      completeness: {
        expectedByTypeAndStatus: { "project:active": 1 },
        actualByTypeAndStatus: { "project:active": 1 }
      },
      maxMissingFiles: 1
    });

    expect(warningOnly.passed).toBe(true);
    expect(warningOnly.warnings).toHaveLength(1);
  });

  it("dedupes person completeness expectations across duplicate access records", async () => {
    const outputDir = createTempDir("export-pipeline-people-");
    const activeProjects = [{ id: 10 }, { id: 11 }];

    const resourcesByPath: Record<string, unknown[]> = {
      "/projects/10/recordings": [],
      "/projects/10/topics": [],
      "/projects/10/documents": [],
      "/projects/10/todolists": [],
      "/projects/10/uploads": [],
      "/projects/10/vaults": [],
      "/projects/10/accesses": [{ id: 501 }, { id: 501 }, { id: 502 }],
      "/projects/11/recordings": [],
      "/projects/11/topics": [],
      "/projects/11/documents": [],
      "/projects/11/todolists": [],
      "/projects/11/uploads": [],
      "/projects/11/vaults": [],
      "/projects/11/accesses": [{ id: 501 }, { id: 502 }, { id: 502 }]
    };

    const client = {
      async getCollectionAll<T>(
        path: string,
        options?: { searchParams?: Record<string, string | number | undefined> }
      ): Promise<T[]> {
        if (path === "/projects") {
          const status = options?.searchParams?.status;
          return (status === "active" ? activeProjects : []) as T[];
        }

        const records = resourcesByPath[path];
        if (!records) {
          throw new Error(`Unexpected path in test mock: ${path}`);
        }
        return records as T[];
      },
      async downloadBinary(): Promise<{ body: Buffer; contentType: string | null }> {
        throw new Error("downloadBinary should not be called in dry-run export test");
      }
    } as unknown as BasecampClient;

    const manifest = await runExportPipeline(client, {
      outputDir,
      statuses: ["active"],
      resume: false,
      dryRun: true,
      downloadTimeoutMs: 1_000,
      maxConcurrency: 2,
      maxMissingDownloads: 0
    });

    expect(manifest.validation.passed).toBe(true);
    expect(manifest.validation.metrics.completenessMismatchCount).toBe(0);
    expect(manifest.completeness.expectedByTypeAndStatus["person:active"]).toBe(2);
    expect(manifest.completeness.actualByTypeAndStatus["person:active"]).toBe(2);
    expect(manifest.counts.byType.person).toBe(2);
  });
});
