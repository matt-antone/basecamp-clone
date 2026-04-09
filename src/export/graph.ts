import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExportEdge, ExportEdgeType, ExportNode, ExportNodeType } from "./types.js";

function normalizeForStableJson(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, normalizeForStableJson(inner)] as const)
      .filter(([, inner]) => inner !== undefined);
    return Object.fromEntries(entries);
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function canonicalNodeId(
  type: ExportNodeType,
  sourceId: string | number,
  projectId?: number
): string {
  if (projectId === undefined) {
    return `${type}:${String(sourceId)}`;
  }
  return `${type}:${projectId}:${String(sourceId)}`;
}

export function canonicalEdgeId(type: ExportEdgeType, from: string, to: string): string {
  const digest = createHash("sha256").update(`${type}|${from}|${to}`).digest("hex");
  return `edge:${digest}`;
}

export class GraphBuilder {
  private readonly nodes = new Map<string, ExportNode>();
  private readonly edges = new Map<string, ExportEdge>();

  addNode(node: ExportNode): boolean {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, node);
      return true;
    }

    const mergedData = {
      ...existing.data,
      ...node.data
    };
    this.nodes.set(node.id, {
      ...existing,
      ...node,
      data: mergedData
    });
    return false;
  }

  addEdge(type: ExportEdgeType, from: string, to: string, data?: Record<string, unknown>): void {
    const id = canonicalEdgeId(type, from, to);
    const existing = this.edges.get(id);
    if (!existing) {
      this.edges.set(id, { id, type, from, to, data });
      return;
    }
    if (!data) {
      return;
    }
    this.edges.set(id, {
      ...existing,
      data: {
        ...(existing.data ?? {}),
        ...data
      }
    });
  }

  getNodeIds(): Set<string> {
    return new Set(this.nodes.keys());
  }

  getSortedNodes(): ExportNode[] {
    return [...this.nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getSortedEdges(): ExportEdge[] {
    return [...this.edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      counts[node.type] = (counts[node.type] ?? 0) + 1;
    }
    return counts;
  }
}

export async function writeGraphArtifacts(
  outputDir: string,
  graph: GraphBuilder
): Promise<{ nodesPath: string; edgesPath: string }> {
  await mkdir(outputDir, { recursive: true });
  const nodesPath = path.join(outputDir, "nodes.ndjson");
  const edgesPath = path.join(outputDir, "edges.ndjson");

  const nodeLines = graph
    .getSortedNodes()
    .map((node) => stableStringify(node))
    .join("\n");
  const edgeLines = graph
    .getSortedEdges()
    .map((edge) => stableStringify(edge))
    .join("\n");

  await writeFile(nodesPath, nodeLines.length > 0 ? `${nodeLines}\n` : "", "utf8");
  await writeFile(edgesPath, edgeLines.length > 0 ? `${edgeLines}\n` : "", "utf8");

  return { nodesPath, edgesPath };
}
