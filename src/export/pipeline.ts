import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { BasecampClient } from "../basecamp/client.js";
import { BasecampApiError } from "../errors.js";
import { CheckpointStore } from "./checkpoint.js";
import { writeCoverageMatrix } from "./contracts.js";
import { collectFileReferences, materializeFiles } from "./files.js";
import { GraphBuilder, canonicalNodeId, writeGraphArtifacts } from "./graph.js";
import { classifyRetryError, executeWithRetry } from "./retry.js";
import { runValidation } from "./validation.js";
import type {
  ExportEdgeType,
  ExportFailure,
  ExportManifest,
  ExportNodeType,
  ExportPipelineOptions,
  ExportStatus,
  FileReference
} from "./types.js";

type JsonObject = Record<string, unknown>;

type ProjectWithStatus = {
  status: ExportStatus;
  record: JsonObject;
};

type ExpectedNodeState = {
  type: ExportNodeType;
  status: ExportStatus;
};

const MANIFEST_SCHEMA_VERSION = "1.0.0";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stableFallbackId(value: unknown): string {
  const source = JSON.stringify(value);
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function edgeForType(type: string): ExportEdgeType | undefined {
  if (
    type === "IN_PROJECT" ||
    type === "PARENT_OF" ||
    type === "COMMENTS_ON" ||
    type === "CREATED_BY" ||
    type === "HAS_FILE" ||
    type === "IN_VAULT"
  ) {
    return type;
  }
  return undefined;
}

async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const tempPath = `${targetPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, targetPath);
}

async function fetchCollection(
  client: BasecampClient,
  endpoint: string,
  searchParams: Record<string, string | number | undefined> = {}
): Promise<{ records: JsonObject[]; missing: boolean; status?: number }> {
  try {
    const raw = await executeWithRetry(
      async () =>
        client.getCollectionAll<unknown>(endpoint, {
          searchParams
        }),
      {
        maxAttempts: 4
      }
    );

    return {
      records: raw.filter(isObject),
      missing: false
    };
  } catch (error) {
    if (error instanceof BasecampApiError && error.status === 404) {
      return {
        records: [],
        missing: true,
        status: error.status
      };
    }
    throw error;
  }
}

function resolveSourceId(record: JsonObject): string {
  const raw = getNumber(record.id) ?? getString(record.id);
  if (raw !== undefined) {
    return String(raw);
  }
  return stableFallbackId(record);
}

function incrementCounter(counter: Record<string, number>, type: string, status?: string): void {
  if (!status) {
    return;
  }
  const key = `${type}:${status}`;
  counter[key] = (counter[key] ?? 0) + 1;
}

function setExpectedNodeState(
  expectedByNodeId: Map<string, ExpectedNodeState>,
  nodeId: string,
  type: ExportNodeType,
  status: ExportStatus
): void {
  expectedByNodeId.set(nodeId, { type, status });
}

function buildExpectedCounts(
  expectedByNodeId: Map<string, ExpectedNodeState>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of expectedByNodeId.values()) {
    incrementCounter(counts, node.type, node.status);
  }
  return counts;
}

function addCreatorEdge(
  graph: GraphBuilder,
  nodeId: string,
  creatorValue: unknown
): void {
  if (!isObject(creatorValue)) {
    return;
  }

  const creatorId = getNumber(creatorValue.id) ?? getString(creatorValue.id);
  if (creatorId === undefined) {
    return;
  }

  const personNodeId = canonicalNodeId("person", creatorId);
  graph.addNode({
    id: personNodeId,
    type: "person",
    sourceId: String(creatorId),
    data: creatorValue
  });
  graph.addEdge("CREATED_BY", nodeId, personNodeId);
}

function addNodeForRecord(
  graph: GraphBuilder,
  files: FileReference[],
  expectedByNodeId: Map<string, ExpectedNodeState>,
  options: {
    nodeType: ExportNodeType;
    record: JsonObject;
    projectId: number;
    status: ExportStatus;
    resource: string;
    includeProjectEdge?: boolean;
  }
): string {
  const sourceId = resolveSourceId(options.record);
  const useProjectScope = options.nodeType !== "person";
  const nodeId = canonicalNodeId(
    options.nodeType,
    sourceId,
    useProjectScope ? options.projectId : undefined
  );

  graph.addNode({
    id: nodeId,
    type: options.nodeType,
    sourceId,
    projectId: useProjectScope ? options.projectId : undefined,
    status: options.status,
    url: getString(options.record.url),
    appUrl: getString(options.record.app_url),
    createdAt: getString(options.record.created_at),
    updatedAt: getString(options.record.updated_at),
    data: {
      resource: options.resource,
      ...options.record
    }
  });

  setExpectedNodeState(expectedByNodeId, nodeId, options.nodeType, options.status);

  if (options.includeProjectEdge ?? useProjectScope) {
    const projectNodeId = canonicalNodeId("project", options.projectId);
    graph.addEdge("IN_PROJECT", nodeId, projectNodeId);
  }

  addCreatorEdge(graph, nodeId, options.record.creator);
  addCreatorEdge(graph, nodeId, options.record.last_updater);
  addCreatorEdge(graph, nodeId, options.record.assignee);

  files.push(...collectFileReferences(options.record, nodeId));
  return nodeId;
}

function trackFailure(
  failures: ExportFailure[],
  failure: Omit<ExportFailure, "at">
): void {
  failures.push({
    ...failure,
    at: new Date().toISOString()
  });
}

async function writeFailureReport(outputDir: string, failures: ExportFailure[]): Promise<void> {
  const deadLetterPath = path.join(outputDir, "dead-letter.ndjson");
  const lines = failures
    .slice()
    .sort((left, right) => left.at.localeCompare(right.at))
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  await writeFile(deadLetterPath, lines.length > 0 ? `${lines}\n` : "", "utf8");
}

export async function runExportPipeline(
  client: BasecampClient,
  options: ExportPipelineOptions
): Promise<ExportManifest> {
  await mkdir(options.outputDir, { recursive: true });

  const checkpointPath = path.join(options.outputDir, "checkpoint.json");
  const manifestPath = path.join(options.outputDir, "manifest.json");
  const checkpointStore = new CheckpointStore(checkpointPath);

  if (!options.resume) {
    await checkpointStore.reset();
  }

  const checkpoint = options.resume
    ? await checkpointStore.load().catch(() => undefined)
    : undefined;
  const completedResources = new Set(Object.keys(checkpoint?.completed ?? {}));
  const failures: ExportFailure[] = [];
  const graph = new GraphBuilder();
  const fileReferences: FileReference[] = [];
  const expectedByNodeId = new Map<string, ExpectedNodeState>();

  const coverage = await writeCoverageMatrix(options.outputDir, options.statuses);

  const projectsById = new Map<number, ProjectWithStatus>();
  for (const status of options.statuses) {
    try {
      const result = await fetchCollection(client, "/projects", { status });
      for (const projectRecord of result.records) {
        const projectId = getNumber(projectRecord.id);
        if (projectId === undefined) {
          continue;
        }
        if (!projectsById.has(projectId)) {
          projectsById.set(projectId, { status, record: projectRecord });
        }
      }
    } catch (error) {
      const classification = classifyRetryError(error);
      const message = error instanceof Error ? error.message : String(error);
      trackFailure(failures, {
        stage: "fetch",
        resource: "projects",
        status: classification.status,
        retryable: classification.retryable,
        message,
        details: { status }
      });
    }
  }

  const projects = [...projectsById.values()].sort((left, right) => {
    const leftId = getNumber(left.record.id) ?? 0;
    const rightId = getNumber(right.record.id) ?? 0;
    return leftId - rightId;
  });

  for (const project of projects) {
    const projectId = getNumber(project.record.id);
    if (projectId === undefined) {
      continue;
    }

    const projectNodeId = canonicalNodeId("project", projectId);
    graph.addNode({
      id: projectNodeId,
      type: "project",
      sourceId: String(projectId),
      projectId,
      status: project.status,
      url: getString(project.record.url),
      appUrl: getString(project.record.app_url),
      updatedAt: getString(project.record.updated_at),
      data: project.record
    });
    setExpectedNodeState(expectedByNodeId, projectNodeId, "project", project.status);

    const resources = [
      { name: "recordings", endpoint: `/projects/${projectId}/recordings`, nodeType: "recording" },
      { name: "topics", endpoint: `/projects/${projectId}/topics`, nodeType: "message" },
      { name: "documents", endpoint: `/projects/${projectId}/documents`, nodeType: "document" },
      { name: "todolists", endpoint: `/projects/${projectId}/todolists`, nodeType: "todolist" },
      { name: "uploads", endpoint: `/projects/${projectId}/uploads`, nodeType: "upload" },
      { name: "vaults", endpoint: `/projects/${projectId}/vaults`, nodeType: "vault" },
      { name: "accesses", endpoint: `/projects/${projectId}/accesses`, nodeType: "person" }
    ] as const;

    for (const resource of resources) {
      const checkpointKey = `${project.status}:${projectId}:${resource.name}`;
      if (completedResources.has(checkpointKey)) {
        continue;
      }

      try {
        const result = await fetchCollection(client, resource.endpoint);
        if (result.missing) {
          trackFailure(failures, {
            stage: "fetch",
            resource: resource.name,
            projectId,
            status: result.status,
            retryable: false,
            message: `Endpoint not available: ${resource.endpoint}.`
          });
          completedResources.add(checkpointKey);
          await checkpointStore.markCompleted(checkpointKey, {
            projectId,
            status: project.status,
            resource: resource.name
          });
          continue;
        }

        for (const record of result.records) {
          const nodeId = addNodeForRecord(graph, fileReferences, expectedByNodeId, {
            nodeType: resource.nodeType,
            record,
            projectId,
            status: project.status,
            resource: resource.name,
            includeProjectEdge: resource.nodeType !== "person"
          });

          if (resource.name === "vaults") {
            const uploads = Array.isArray(record.uploads)
              ? (record.uploads.filter(isObject) as JsonObject[])
              : [];
            for (const uploadRecord of uploads) {
              const uploadNodeId = addNodeForRecord(
                graph,
                fileReferences,
                expectedByNodeId,
                {
                  nodeType: "upload",
                  record: uploadRecord,
                  projectId,
                  status: project.status,
                  resource: "vault-upload"
                }
              );
              graph.addEdge("IN_VAULT", uploadNodeId, nodeId);
            }
          }

          if (resource.name === "todolists") {
            const todos = [
              ...(Array.isArray(record.todos) ? record.todos : []),
              ...(Array.isArray(record.assigned_todos) ? record.assigned_todos : [])
            ].filter(isObject) as JsonObject[];

            for (const todoRecord of todos) {
              const todoNodeId = addNodeForRecord(
                graph,
                fileReferences,
                expectedByNodeId,
                {
                  nodeType: "todo",
                  record: todoRecord,
                  projectId,
                  status: project.status,
                  resource: "todo"
                }
              );
              graph.addEdge("PARENT_OF", nodeId, todoNodeId);
            }
          }

          if (resource.name === "topics") {
            const topicable = isObject(record.topicable) ? record.topicable : undefined;
            const topicType = getString(topicable?.type) ?? "";
            if (topicType.toLowerCase() === "message") {
              const messageId = getNumber(topicable?.id) ?? getNumber(record.id);
              if (messageId !== undefined) {
                const commentsEndpoint = `/projects/${projectId}/messages/${messageId}/comments`;
                const commentsResult = await fetchCollection(client, commentsEndpoint);
                for (const commentRecord of commentsResult.records) {
                  const commentNodeId = addNodeForRecord(
                    graph,
                    fileReferences,
                    expectedByNodeId,
                    {
                      nodeType: "comment",
                      record: commentRecord,
                      projectId,
                      status: project.status,
                      resource: "comment"
                    }
                  );
                  graph.addEdge("COMMENTS_ON", commentNodeId, nodeId);
                }
              }
            }
          }
        }

        completedResources.add(checkpointKey);
        await checkpointStore.markCompleted(checkpointKey, {
          projectId,
          status: project.status,
          resource: resource.name
        });
      } catch (error) {
        const classification = classifyRetryError(error);
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(failures, {
          stage: "fetch",
          resource: resource.name,
          projectId,
          status: classification.status,
          retryable: classification.retryable,
          message
        });
      }
    }
  }

  await writeGraphArtifacts(options.outputDir, graph);

  const fileResult = await materializeFiles(fileReferences, options.outputDir, {
    dryRun: options.dryRun,
    timeoutMs: options.downloadTimeoutMs,
    maxConcurrency: options.maxConcurrency,
    download: (url, timeoutMs) => client.downloadBinary(url, timeoutMs)
  });
  failures.push(...fileResult.failures);

  for (const fileEntry of fileResult.files) {
    if (fileEntry.sha256 && fileEntry.relationNodeId) {
      const relationNodeId = fileEntry.relationNodeId;
      const fileNodeId = canonicalNodeId("upload", fileEntry.sha256);
      graph.addNode({
        id: fileNodeId,
        type: "upload",
        sourceId: fileEntry.sha256,
        data: {
          storedPath: fileEntry.storedPath,
          sourceUrl: fileEntry.sourceUrl,
          contentType: fileEntry.contentType
        }
      });
      const edgeType = edgeForType("HAS_FILE");
      if (edgeType) {
        graph.addEdge(edgeType, relationNodeId, fileNodeId);
      }
    }
  }

  const finalizedGraphArtifacts = await writeGraphArtifacts(options.outputDir, graph);

  const actualByTypeAndStatus: Record<string, number> = {};
  for (const node of graph.getSortedNodes()) {
    if (node.status) {
      incrementCounter(actualByTypeAndStatus, node.type, node.status);
    }
  }
  const expectedByTypeAndStatus = buildExpectedCounts(expectedByNodeId);

  const validationFiles = fileResult.files
    .filter((entry) => entry.downloaded && entry.storedPath && entry.sha256 && entry.size !== undefined)
    .map((entry) => ({
      nodeId: entry.relationNodeId,
      relativePath: entry.storedPath as string,
      sha256: entry.sha256 as string,
      size: entry.size as number,
      downloaded: entry.downloaded
    }));

  const validation = await runValidation({
    outputDir: options.outputDir,
    nodes: graph.getSortedNodes().map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status
    })),
    edges: graph.getSortedEdges().map((edge) => ({
      id: edge.id,
      type: edge.type,
      from: edge.from,
      to: edge.to
    })),
    files: validationFiles,
    completeness: {
      expectedByTypeAndStatus,
      actualByTypeAndStatus
    },
    maxMissingFiles: options.maxMissingDownloads
  });

  if (!validation.passed) {
    for (const message of validation.errors) {
      trackFailure(failures, {
        stage: "validate",
        resource: "integrity",
        retryable: false,
        message
      });
    }
  }

  await writeFailureReport(options.outputDir, failures);

  const countsByStatus: Record<string, number> = {};
  for (const node of graph.getSortedNodes()) {
    if (node.status) {
      countsByStatus[node.status] = (countsByStatus[node.status] ?? 0) + 1;
    }
  }

  const manifest: ExportManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    outputDir: options.outputDir,
    statuses: options.statuses,
    artifacts: {
      nodesPath: finalizedGraphArtifacts.nodesPath,
      edgesPath: finalizedGraphArtifacts.edgesPath,
      coveragePath: coverage.path,
      checkpointPath,
      filesDir: path.join(options.outputDir, "files")
    },
    counts: {
      nodes: graph.getSortedNodes().length,
      edges: graph.getSortedEdges().length,
      files: fileResult.files.length,
      failures: failures.length,
      byType: graph.countByType(),
      byStatus: countsByStatus
    },
    files: fileResult.files,
    failures,
    validation,
    completeness: {
      expectedByTypeAndStatus,
      actualByTypeAndStatus
    }
  };

  await writeJsonAtomic(manifestPath, manifest);

  if (!validation.passed) {
    throw new Error(`Export validation failed: ${validation.errors.join(" | ")}`);
  }

  return manifest;
}
