// lib/imports/migration/projects.ts
import { resolveTitle, type KnownClient } from "../bc2-client-resolver";
import { parseBc2IsoTimestamptz, type Bc2Project } from "../bc2-fetcher";
import { sanitizeDropboxFolderTitle } from "@/lib/project-storage";
import type { DumpReader, DumpSource } from "../dump-reader";
import {
  incrementCounters,
  logRecord,
  type DataSource,
  type Query,
} from "./jobs";
import type { MigratedProject, ProjectFilter } from "./types";

function dropboxProjectsRootFromEnv(): string {
  const fromEnv =
    process.env.DROPBOX_PROJECTS_ROOT_FOLDER?.trim() ||
    process.env.DROPBOX_ROOT_FOLDER?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "/Projects";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

interface PrePassEntry {
  bc2Id: string;
  createdAt: string;
  baseKey: string;
}

function planDupSuffixes(entries: PrePassEntry[]): Map<string, string> {
  const groups = new Map<string, PrePassEntry[]>();
  for (const e of entries) {
    if (!e.baseKey) continue;
    const list = groups.get(e.baseKey) ?? [];
    list.push(e);
    groups.set(e.baseKey, list);
  }

  const suffixMap = new Map<string, string>();
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      const suffix = i <= 26 ? String.fromCharCode("a".charCodeAt(0) + i - 1) : `a${i - 1}`;
      suffixMap.set(sorted[i].bc2Id, suffix);
    }
  }
  return suffixMap;
}

async function resolveClientIdViaQ(q: Query, code: string): Promise<string> {
  const existing = await q<{ id: string }>(
    "select id from clients where lower(code) = lower($1) limit 1",
    [code],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await q<{ id: string }>(
    "insert into clients (name, code) values ($1, $2) returning id",
    [code, code],
  );
  return created.rows[0].id;
}

async function loadProjects(
  reader: DumpReader,
  filter: ProjectFilter,
): Promise<{ projects: Bc2Project[]; dataSourceByBc2Id: Map<number, DataSource> }> {
  const dataSourceByBc2Id = new Map<number, DataSource>();
  const projects: Bc2Project[] = [];

  const consume = (res: DumpSource<Bc2Project[]>) => {
    const body = res.body ?? [];
    for (const p of body) {
      projects.push(p);
      dataSourceByBc2Id.set(p.id, res.source);
    }
  };

  if (filter === "active" || filter === "all") {
    consume(await reader.activeProjects());
  }
  if (filter === "archived" || filter === "all") {
    consume(await reader.archivedProjects());
  }

  return { projects, dataSourceByBc2Id };
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

  const { projects: allBc2Projects, dataSourceByBc2Id } = await loadProjects(reader, filter);

  // Pre-pass: plan dup suffixes
  const prePassEntries: PrePassEntry[] = [];
  for (const p of allBc2Projects) {
    const r = resolveTitle(p.name, knownClients);
    if ((r.matchedBy === "code" || r.matchedBy === "name") && r.code && r.num) {
      prePassEntries.push({
        bc2Id: String(p.id),
        createdAt: p.created_at,
        baseKey: `${r.code}|${r.num}`,
      });
    }
  }
  const dupSuffixMap = planDupSuffixes(prePassEntries);

  const migrated: MigratedProject[] = [];
  let count = 0;

  for (const bc2Project of allBc2Projects) {
    if (filter === "active" && bc2Project.archived) continue;
    if (filter === "archived" && !bc2Project.archived) continue;
    if (onlyProjectId !== null && bc2Project.id !== onlyProjectId) continue;
    if (limit !== null && count >= limit) break;

    count++;
    const dataSource: DataSource = dataSourceByBc2Id.get(bc2Project.id) ?? "api";

    try {
      // Idempotency: existing import_map_projects mapping
      const existing = await q<{ local_project_id: string }>(
        "select local_project_id from import_map_projects where basecamp_project_id = $1",
        [String(bc2Project.id)],
      );
      if (existing.rows[0]) {
        migrated.push({
          bc2Id: bc2Project.id,
          localId: existing.rows[0].local_project_id,
          name: bc2Project.name,
        });
        await logRecord(q, {
          jobId,
          recordType: "project",
          sourceId: String(bc2Project.id),
          status: "success",
          message: "Already mapped",
          dataSource,
        });
        await incrementCounters(q, jobId, 1, 0);
        continue;
      }

      const resolved = resolveTitle(bc2Project.name, knownClients);
      const { num, title } = resolved;

      let clientId: string | null = null;
      let clientCode = "GEN";
      let clientSlug = "unassigned";

      if (resolved.matchedBy === "code" || resolved.matchedBy === "name") {
        clientId = resolved.clientId;
        clientCode = (resolved.code ?? "GEN").toUpperCase();
        const clientRow = await q<{ name: string }>(
          "select name from clients where id = $1",
          [clientId],
        );
        if (clientRow.rows[0]) {
          clientSlug = slugify(clientRow.rows[0].name);
        }
      } else if (resolved.matchedBy === "auto-create-pending") {
        const newCode = (resolved.autoCreatePrefix ?? resolved.code ?? "UNKNOWN").replace(
          /[\s\-_.]/g,
          "",
        );
        const newName = (resolved.autoCreatePrefix ?? resolved.code ?? "Unknown").trim();
        clientId = await resolveClientIdViaQ(q, newCode);
        // resolveClientIdViaQ uses code as name on insert; rename to the original prefix.
        await q(
          "update clients set name = $1 where id = $2 and name = $3",
          [newName, clientId, newCode],
        );
        clientCode = newCode.toUpperCase();
        clientSlug = slugify(newName);
      } else {
        // matchedBy === "none". Skip orphans (no allowOrphans flag in new function).
        await logRecord(q, {
          jobId,
          recordType: "project",
          sourceId: String(bc2Project.id),
          status: "failed",
          message: `orphan title (no client match): ${bc2Project.name}`,
          dataSource,
        });
        await incrementCounters(q, jobId, 0, 1);
        continue;
      }

      // project_seq: integer prefix of num; otherwise next from clients projects.
      let projectSeq: number | null = null;
      if (num) {
        const numPrefixMatch = num.match(/^(\d+)/);
        projectSeq = numPrefixMatch ? parseInt(numPrefixMatch[1], 10) : null;
      } else if (clientId !== null) {
        const seqRow = await q<{ next_seq: number }>(
          "select coalesce(max(project_seq), 0) + 1 as next_seq from projects where client_id is not distinct from $1",
          [clientId],
        );
        projectSeq = seqRow.rows[0]?.next_seq ?? null;
      }

      const baseProjectCode = clientId !== null && num ? `${clientCode}-${num}` : null;
      const dupSuffix = baseProjectCode ? (dupSuffixMap.get(String(bc2Project.id)) ?? "") : "";
      const projectCode = baseProjectCode ? `${baseProjectCode}${dupSuffix}` : null;

      const projectSlug = title ? slugify(title) : null;
      const folderName = projectCode
        ? `${projectCode}-${sanitizeDropboxFolderTitle(title)}`
        : `_NoCode_${bc2Project.id}-${sanitizeDropboxFolderTitle(title)}`;
      const projectsRoot = dropboxProjectsRootFromEnv();
      const clientFolder = clientCode || "_NoClient";
      const storageDir = bc2Project.archived
        ? `${projectsRoot}/${clientFolder}/_Archive/${folderName}`
        : `${projectsRoot}/${clientFolder}/${folderName}`;
      const urlSlug = projectCode
        ? projectCode.toLowerCase()
        : `${slugify(title || `bc2-${bc2Project.id}`)}-bc2-${bc2Project.id}`;

      const projectCreatedAt =
        parseBc2IsoTimestamptz(bc2Project.created_at) ?? new Date();
      const projectUpdatedAt =
        parseBc2IsoTimestamptz(bc2Project.updated_at) ?? projectCreatedAt;

      const created = await q<{ id: string }>(
        `insert into projects
           (name, slug, description, client_id, archived, created_by,
            project_seq, project_code, client_slug, project_slug, storage_project_dir,
            created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (project_code) do update set name = excluded.name, slug = excluded.slug
         returning id`,
        [
          title,
          urlSlug,
          bc2Project.description ?? null,
          clientId,
          bc2Project.archived,
          "bc2_import",
          projectSeq,
          projectCode,
          clientSlug,
          projectSlug,
          storageDir,
          projectCreatedAt,
          projectUpdatedAt,
        ],
      );
      const localId = created.rows[0].id;

      await q(
        "insert into import_map_projects (basecamp_project_id, local_project_id) values ($1,$2)",
        [String(bc2Project.id), localId],
      );

      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(bc2Project.id),
        status: "success",
        dataSource,
      });
      await incrementCounters(q, jobId, 1, 0);
      migrated.push({ bc2Id: bc2Project.id, localId, name: bc2Project.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(bc2Project.id),
        status: "failed",
        message,
        dataSource,
      });
      await incrementCounters(q, jobId, 0, 1);
    }
  }

  return { migrated };
}
