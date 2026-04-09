import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExportCoverageEntry, ExportStatus } from "./types.js";

export function buildCoverageMatrix(statuses: ExportStatus[]): ExportCoverageEntry[] {
  return [
    {
      resource: "projects",
      endpoint: "/projects",
      included: true,
      reason: "Status-aware project discovery across active, archived, trashed.",
      statuses
    },
    {
      resource: "recordings",
      endpoint: "/projects/:id/recordings",
      included: true,
      reason: "Primary timeline traversal for broad historical coverage.",
      statuses
    },
    {
      resource: "messages",
      endpoint: "/projects/:id/topics",
      included: true,
      reason: "Message/topic extraction for graph entity coverage.",
      statuses
    },
    {
      resource: "comments",
      endpoint: "/projects/:id/messages/:messageId/comments",
      included: true,
      reason: "Comments relationship coverage.",
      statuses
    },
    {
      resource: "documents",
      endpoint: "/projects/:id/documents",
      included: true,
      reason: "Document records and attachments.",
      statuses
    },
    {
      resource: "todos",
      endpoint: "/projects/:id/todolists",
      included: true,
      reason: "Todo/todolist graph entities.",
      statuses
    },
    {
      resource: "uploads",
      endpoint: "/projects/:id/uploads",
      included: true,
      reason: "Downloadable and linked file records.",
      statuses
    },
    {
      resource: "vaults",
      endpoint: "/projects/:id/vaults",
      included: true,
      reason: "Vault containers for uploaded artifacts.",
      statuses
    },
    {
      resource: "people",
      endpoint: "/projects/:id/accesses",
      included: true,
      reason: "Person nodes and CREATED_BY relations.",
      statuses
    },
    {
      resource: "campfire",
      endpoint: "/projects/:id/chats",
      included: false,
      reason: "Excluded from this phase to keep graph scope focused on records/files.",
      statuses
    }
  ];
}

export async function writeCoverageMatrix(
  outputDir: string,
  statuses: ExportStatus[]
): Promise<{ path: string; entries: ExportCoverageEntry[] }> {
  await mkdir(outputDir, { recursive: true });
  const entries = buildCoverageMatrix(statuses);
  const coveragePath = path.join(outputDir, "coverage-matrix.json");

  await writeFile(
    coveragePath,
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        statuses,
        entries
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    path: coveragePath,
    entries
  };
}
