import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type ExportNode = {
  id: string;
  type: string;
  status?: string;
};

export type ExportEdge = {
  id?: string;
  type: string;
  from: string;
  to: string;
};

export type ManifestFileRecord = {
  nodeId: string;
  relativePath: string;
  sha256: string;
  size: number;
  downloaded: boolean;
};

export type CompletenessStats = {
  expectedByTypeAndStatus: Record<string, number>;
  actualByTypeAndStatus: Record<string, number>;
};

export type ValidationOptions = {
  outputDir: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  files: ManifestFileRecord[];
  completeness: CompletenessStats;
  maxMissingFiles: number;
};

export type ValidationReport = {
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

function groupByTypeAndStatus(nodes: ExportNode[]): Record<string, number> {
  const grouped: Record<string, number> = {};

  for (const node of nodes) {
    const key = `${node.type}:${node.status ?? "unknown"}`;
    grouped[key] = (grouped[key] ?? 0) + 1;
  }

  return grouped;
}

export function validateReferentialIntegrity(
  nodes: ExportNode[],
  edges: ExportEdge[]
): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const unresolved: string[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      unresolved.push(
        `${edge.type}:${edge.from}->${edge.to}`
      );
    }
  }

  return unresolved;
}

export function reconcileCompleteness(
  expectedByTypeAndStatus: Record<string, number>,
  actualByTypeAndStatus: Record<string, number>
): string[] {
  const keys = new Set([
    ...Object.keys(expectedByTypeAndStatus),
    ...Object.keys(actualByTypeAndStatus)
  ]);

  const mismatches: string[] = [];

  for (const key of [...keys].sort()) {
    const expected = expectedByTypeAndStatus[key] ?? 0;
    const actual = actualByTypeAndStatus[key] ?? 0;
    if (expected !== actual) {
      mismatches.push(`${key} expected=${expected} actual=${actual}`);
    }
  }

  return mismatches;
}

export async function validateFileIntegrity(
  outputDir: string,
  files: ManifestFileRecord[]
): Promise<{
  missing: string[];
  checksumMismatches: string[];
}> {
  const missing: string[] = [];
  const checksumMismatches: string[] = [];

  for (const file of files) {
    if (!file.downloaded) {
      continue;
    }

    const absolutePath = path.join(outputDir, file.relativePath);

    try {
      const content = await readFile(absolutePath);
      const sha256 = createHash("sha256").update(content).digest("hex");

      if (content.length !== file.size || sha256 !== file.sha256) {
        checksumMismatches.push(file.relativePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push(file.relativePath);
      } else {
        throw error;
      }
    }
  }

  return { missing, checksumMismatches };
}

export async function runValidation(
  options: ValidationOptions
): Promise<ValidationReport> {
  const unresolvedEdges = validateReferentialIntegrity(options.nodes, options.edges);
  const groupedActual = groupByTypeAndStatus(options.nodes);
  const completenessMismatches = reconcileCompleteness(
    options.completeness.expectedByTypeAndStatus,
    options.completeness.actualByTypeAndStatus || groupedActual
  );

  const fileCheck = await validateFileIntegrity(options.outputDir, options.files);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (unresolvedEdges.length > 0) {
    errors.push(`Referential integrity failed (${unresolvedEdges.length} unresolved edges).`);
  }

  if (fileCheck.checksumMismatches.length > 0) {
    errors.push(`File integrity failed (${fileCheck.checksumMismatches.length} checksum mismatches).`);
  }

  if (completenessMismatches.length > 0) {
    errors.push(`Completeness reconciliation failed (${completenessMismatches.length} mismatches).`);
  }

  if (fileCheck.missing.length > options.maxMissingFiles) {
    errors.push(
      `Missing file threshold exceeded (${fileCheck.missing.length} > ${options.maxMissingFiles}).`
    );
  } else if (fileCheck.missing.length > 0) {
    warnings.push(
      `Missing files within threshold (${fileCheck.missing.length}/${options.maxMissingFiles}).`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      unresolvedEdgeCount: unresolvedEdges.length,
      missingFileCount: fileCheck.missing.length,
      checksumMismatchCount: fileCheck.checksumMismatches.length,
      completenessMismatchCount: completenessMismatches.length
    }
  };
}
