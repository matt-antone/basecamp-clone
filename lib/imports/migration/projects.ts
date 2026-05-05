// lib/imports/migration/projects.ts
import { createProject } from "@/lib/repositories";
import { resolveTitle, type KnownClient, type ResolvedTitle } from "../bc2-client-resolver";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";
import type { Bc2Project } from "../bc2-fetcher";
import type { MigratedProject, ProjectFilter } from "./types";

interface PrePassEntry {
  bc2Id: number;
  rawName: string;
  resolved: ResolvedTitle;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function planDupSuffixes(entries: PrePassEntry[]): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.resolved.code ?? ""}|${slugify(e.resolved.title ?? "")}`;
    const idx = (counts.get(key) ?? 0) + 1;
    counts.set(key, idx);
    out.set(String(e.bc2Id), idx === 1 ? "" : `-${idx}`);
  }
  return out;
}

export async function migrateProjects(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  filter: ProjectFilter;
  limit: number | null;
  onlyProjectId: number | null;
  knownClients: KnownClient[];
}): Promise<{ migrated: MigratedProject[] }> {
  const { reader, q, jobId, filter, limit, onlyProjectId, knownClients } = args;

  const sources: Array<{
    src: "active" | "archived";
    data: Bc2Project[];
    dataSource: DataSource;
  }> = [];
  if (filter === "active" || filter === "all") {
    const r = await reader.activeProjects();
    sources.push({ src: "active", data: r.body ?? [], dataSource: r.source });
  }
  if (filter === "archived" || filter === "all") {
    const r = await reader.archivedProjects();
    sources.push({ src: "archived", data: r.body ?? [], dataSource: r.source });
  }

  let candidates = sources.flatMap((s) =>
    s.data.map((p) => ({ project: p, dataSource: s.dataSource })),
  );

  if (onlyProjectId !== null) {
    candidates = candidates.filter((c) => c.project.id === onlyProjectId);
  }
  if (limit !== null && limit > 0) {
    candidates = candidates.slice(0, limit);
  }

  // Resolve titles up front so the dup-suffix planner can run.
  const prepass: PrePassEntry[] = [];
  for (const c of candidates) {
    const resolved = await Promise.resolve(resolveTitle(c.project.name, knownClients));
    prepass.push({ bc2Id: c.project.id, rawName: c.project.name, resolved });
  }
  planDupSuffixes(prepass); // suffix map currently advisory; createProject derives codes server-side.

  const migrated: MigratedProject[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const { project, dataSource } = candidates[i];
    const resolved = prepass[i].resolved;
    try {
      const existing = await q<{ local_project_id: string }>(
        "select local_project_id from import_map_projects where basecamp_project_id = $1",
        [String(project.id)],
      );
      let localId: string;
      if (existing.rows[0]) {
        localId = existing.rows[0].local_project_id;
      } else {
        const created = await createProject({
          name: resolved.title || project.name,
          description: project.description ?? undefined,
          createdBy: "bc2_import",
          clientId: resolved.clientId ?? undefined,
        });
        localId = (created as { id: string }).id;
        await q(
          "insert into import_map_projects (basecamp_project_id, local_project_id) values ($1, $2)",
          [String(project.id), localId],
        );
      }
      migrated.push({ bc2Id: project.id, localId, name: project.name });
      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(project.id),
        status: "success",
        dataSource,
      });
    } catch (err) {
      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(project.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource,
      });
    }
  }
  return { migrated };
}
