export const EXPORT_STATUSES = ["active", "archived", "trashed"] as const;

export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_NODE_TYPES = [
  "project",
  "recording",
  "message",
  "comment",
  "document",
  "upload",
  "vault",
  "todo",
  "todolist",
  "person"
] as const;

export type ExportNodeType = (typeof EXPORT_NODE_TYPES)[number];

export const EXPORT_EDGE_TYPES = [
  "IN_PROJECT",
  "PARENT_OF",
  "COMMENTS_ON",
  "CREATED_BY",
  "HAS_FILE",
  "IN_VAULT"
] as const;

export type ExportEdgeType = (typeof EXPORT_EDGE_TYPES)[number];

export type ExportNode = {
  id: string;
  type: ExportNodeType;
  sourceId: string;
  projectId?: number;
  status?: ExportStatus;
  url?: string;
  appUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  data: Record<string, unknown>;
};

export type ExportEdge = {
  id: string;
  type: ExportEdgeType;
  from: string;
  to: string;
  data?: Record<string, unknown>;
};

export type FileReference = {
  sourceUrl: string;
  relationNodeId: string;
  downloadable: boolean;
  metadata: Record<string, unknown>;
};

export type ManifestFileEntry = {
  sourceUrl: string;
  relationNodeId: string;
  downloadable: boolean;
  downloaded: boolean;
  metadataOnly: boolean;
  sha256?: string;
  size?: number;
  storedPath?: string;
  contentType?: string;
  metadata: Record<string, unknown>;
};

export type ExportFailure = {
  stage: "fetch" | "download" | "transform" | "validate";
  resource: string;
  projectId?: number;
  status?: number;
  retryable: boolean;
  message: string;
  at: string;
  details?: Record<string, unknown>;
};

export type ExportCheckpoint = {
  schemaVersion: string;
  updatedAt: string;
  completedResources: string[];
};

export type ExportCoverageEntry = {
  resource: string;
  endpoint: string;
  included: boolean;
  reason: string;
  statuses: ExportStatus[];
};

export type ExportManifest = {
  schemaVersion: string;
  generatedAt: string;
  outputDir: string;
  statuses: ExportStatus[];
  artifacts: {
    nodesPath: string;
    edgesPath: string;
    coveragePath: string;
    checkpointPath: string;
    filesDir: string;
  };
  counts: {
    nodes: number;
    edges: number;
    files: number;
    failures: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  };
  files: ManifestFileEntry[];
  failures: ExportFailure[];
  validation: {
    passed: boolean;
    errors: string[];
    warnings: string[];
    metrics: {
      unresolvedEdgeCount: number;
      missingFileCount: number;
      checksumMismatchCount: number;
      completenessMismatchCount: number;
    };
  };
  completeness: {
    expectedByTypeAndStatus: Record<string, number>;
    actualByTypeAndStatus: Record<string, number>;
  };
};

export type ExportPipelineOptions = {
  outputDir: string;
  statuses: ExportStatus[];
  resume: boolean;
  dryRun: boolean;
  downloadTimeoutMs: number;
  maxConcurrency: number;
  maxMissingDownloads: number;
};
