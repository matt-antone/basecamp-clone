#!/usr/bin/env npx tsx
// scripts/migrate-bc2.ts

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool, type QueryResultRow } from "pg";
import { Bc2Client } from "../lib/imports/bc2-client";
import {
  Bc2Fetcher,
  parseBc2IsoTimestamptz,
  type Bc2Attachment,
  type Bc2Project,
  type Bc2ProjectSource
} from "../lib/imports/bc2-fetcher";
import type { Bc2DownloadEnv } from "../lib/imports/bc2-attachment-download";
import {
  resolveBc2AttachmentLinkage,
  resolveBc2LinkageFromAttachable
} from "../lib/imports/bc2-attachment-linkage";
import { importBc2FileFromAttachment } from "../lib/imports/bc2-migrate-single-file";
import {
  resolveClientId,
  resolvePerson
} from "../lib/imports/bc2-transformer";
import { resolveTitle, type KnownClient } from "../lib/imports/bc2-client-resolver";
import { createThread, createComment, createFileMetadata } from "../lib/repositories";
import { DropboxStorageAdapter } from "../lib/storage/dropbox-adapter";
import { getProjectStorageDir, sanitizeDropboxFolderTitle } from "../lib/project-storage";

function dropboxProjectsRootFromEnv(): string {
  const fromEnv =
    process.env.DROPBOX_PROJECTS_ROOT_FOLDER?.trim() ||
    process.env.DROPBOX_ROOT_FOLDER?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "/Projects";
}

// ── Script-local DB pool (bypasses lib/db → lib/config's server-only guard) ──
const _pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return _pool.query<T>(text, values);
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

type RunMode = "dry" | "limited" | "full";

interface CliFlags {
  mode: RunMode;
  limit: number;
  files: boolean;
  onlyFiles: boolean;
  fromProject: string | null;
  /** BC2 list: active (default), archived-only, or all */
  projectSource: Bc2ProjectSource;
  /** Insert orphan projects (matchedBy="none") with NULL identity instead of skipping. */
  allowOrphans: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find(a => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=")[1] : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);

  const rawMode = get("mode") ?? "full";
  if (!["dry", "limited", "full"].includes(rawMode)) {
    console.error(`Unknown --mode=${rawMode}. Use dry | limited | full.`);
    process.exit(1);
  }

  const rawProjects = get("projects") ?? "active";
  if (!["active", "archived", "all"].includes(rawProjects)) {
    console.error(`Unknown --projects=${rawProjects}. Use active | archived | all.`);
    process.exit(1);
  }

  return {
    mode: rawMode as RunMode,
    limit: parseInt(get("limit") ?? "5", 10),
    files: has("files"),
    onlyFiles: has("only-files"),
    fromProject: get("from-project"),
    projectSource: rawProjects as Bc2ProjectSource,
    allowOrphans: has("allow-orphans")
  };
}

// ── Env validation ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// ── Import job helpers ────────────────────────────────────────────────────────

async function createMigrationJob(options: object): Promise<string> {
  const result = await query(
    "insert into import_jobs (status, options) values ('running', $1) returning id",
    [JSON.stringify(options)]
  );
  return result.rows[0].id as string;
}

async function logRecord(
  jobId: string,
  recordType: string,
  sourceId: string,
  status: "success" | "failed",
  message?: string
) {
  await query(
    "insert into import_logs (job_id, record_type, source_record_id, status, message) values ($1,$2,$3,$4,$5)",
    [jobId, recordType, sourceId, status, message ?? null]
  );
}

async function incrementCounters(jobId: string, success: number, failed: number) {
  await query(
    `update import_jobs set
       success_count = success_count + $2,
       failed_count  = failed_count  + $3,
       total_records = total_records + $2 + $3
     where id = $1`,
    [jobId, success, failed]
  );
}

async function finishJob(jobId: string, status: "completed" | "failed" | "interrupted") {
  await query(
    "update import_jobs set status=$2, finished_at=now() where id=$1",
    [jobId, status]
  );
}

// ── Progress output ───────────────────────────────────────────────────────────

function pad(n: number, total: number): string {
  const width = String(total).length;
  return String(n).padStart(width, " ");
}

// ── People phase ──────────────────────────────────────────────────────────────

async function migratePeople(
  jobId: string,
  fetcher: Bc2Fetcher,
  mode: RunMode
): Promise<Map<number, string>> {
  const personMap = new Map<number, string>(); // bc2 id → local profile id
  process.stdout.write("Resolving people...\n");

  for await (const person of fetcher.fetchPeople()) {
    try {
      if (mode !== "dry") {
        const resolved = await resolvePerson(person, jobId);
        personMap.set(person.id, resolved.localProfileId);
        await logRecord(jobId, "person", String(person.id), "success");
        await incrementCounters(jobId, 1, 0);
      } else {
        personMap.set(person.id, `dry_${person.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  person ${person.id} FAILED: ${msg}\n`);
      if (mode !== "dry") {
        await logRecord(jobId, "person", String(person.id), "failed", msg);
        await incrementCounters(jobId, 0, 1);
      }
    }
  }

  process.stdout.write(`  ${personMap.size} people resolved\n`);
  return personMap;
}

// ── Projects phase ────────────────────────────────────────────────────────────

async function fetchKnownClients(): Promise<KnownClient[]> {
  const r = await query<{ id: string; code: string; name: string }>(
    "select id, code, name from clients order by code"
  );
  return r.rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
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
    // sorted[0] keeps bare (no entry written)
    for (let i = 1; i < sorted.length; i++) {
      const suffix = i <= 26 ? String.fromCharCode("a".charCodeAt(0) + i - 1) : `a${i - 1}`;
      suffixMap.set(sorted[i].bc2Id, suffix);
    }
  }
  return suffixMap;
}

interface OrphanRow {
  bc2Id: number;
  name: string;
  archived: boolean;
  createdAt: string;
}

interface MigratedProject {
  bc2Id: number;
  localId: string;
  name: string;
}

async function migrateProjects(
  jobId: string,
  fetcher: Bc2Fetcher,
  personMap: Map<number, string>,
  flags: CliFlags
): Promise<MigratedProject[]> {
  const projects: MigratedProject[] = [];
  process.stdout.write("Fetching projects...\n");

  const knownClients = await fetchKnownClients();
  process.stdout.write(`Pre-fetched ${knownClients.length} known clients for resolver\n`);

  // ── Pre-pass: collect projects + plan dup-suffix map ──
  process.stdout.write("Pre-pass: collecting projects for dup disambiguation...\n");
  const allBc2Projects: Bc2Project[] = [];
  const prePassEntries: PrePassEntry[] = [];
  for await (const p of fetcher.fetchProjects({ source: flags.projectSource })) {
    allBc2Projects.push(p);
    const r = resolveTitle(p.name, knownClients);
    if ((r.matchedBy === "code" || r.matchedBy === "name") && r.code && r.num) {
      prePassEntries.push({
        bc2Id: String(p.id),
        createdAt: p.created_at,
        baseKey: `${r.code}|${r.num}`
      });
    }
  }
  const dupSuffixMap = planDupSuffixes(prePassEntries);
  process.stdout.write(`Pre-pass: fetched ${allBc2Projects.length} projects, ${dupSuffixMap.size} duplicates assigned suffixes\n`);

  const orphans: OrphanRow[] = [];
  const summary = {
    matchedBy: { code: 0, name: 0, "auto-create-pending": 0, none: 0 } as Record<string, number>,
    autoCreatedClients: [] as Array<{ code: string; name: string; bc2Id: number }>,
    dupSuffixesAssigned: dupSuffixMap.size
  };

  let count = 0;
  for (const bc2Project of allBc2Projects) {
    if (flags.projectSource === "active" && bc2Project.archived) {
      continue;
    }
    if (flags.projectSource === "archived" && !bc2Project.archived) {
      continue;
    }
    if (flags.mode === "limited" && count >= flags.limit) break;
    if (flags.fromProject && !bc2Project.name.startsWith(flags.fromProject)) {
      continue;
    }

    count++;
    if (count % 50 === 0) {
      process.stdout.write(`  ...${count} fetched\n`);
    }
    try {
      if (flags.mode === "dry") {
        projects.push({ bc2Id: bc2Project.id, localId: `dry_${bc2Project.id}`, name: bc2Project.name });
        continue;
      }

      // Idempotency: check map
      const existing = await query(
        "select local_project_id from import_map_projects where basecamp_project_id = $1",
        [String(bc2Project.id)]
      );
      if (existing.rows[0]) {
        projects.push({ bc2Id: bc2Project.id, localId: existing.rows[0].local_project_id as string, name: bc2Project.name });
        await logRecord(jobId, "project", String(bc2Project.id), "success", "Already mapped");
        await incrementCounters(jobId, 1, 0);
        continue;
      }

      const resolved = resolveTitle(bc2Project.name, knownClients);
      const { num, title } = resolved;
      summary.matchedBy[resolved.matchedBy] = (summary.matchedBy[resolved.matchedBy] ?? 0) + 1;

      // ── Branch on matchedBy ──
      let clientId: string | null = null;
      let clientCode = "GEN";
      let clientSlug = "unassigned";

      if (resolved.matchedBy === "code" || resolved.matchedBy === "name") {
        clientId = resolved.clientId;
        clientCode = (resolved.code ?? "GEN").toUpperCase();
        const clientRow = await query<{ name: string }>(
          "select name from clients where id = $1",
          [clientId]
        );
        if (clientRow.rows[0]) {
          clientSlug = slugify(clientRow.rows[0].name);
        }
      } else if (resolved.matchedBy === "auto-create-pending") {
        const newCode = (resolved.autoCreatePrefix ?? resolved.code ?? "UNKNOWN").replace(/[\s\-_.]/g, "");
        const newName = (resolved.autoCreatePrefix ?? resolved.code ?? "Unknown").trim();
        clientId = await resolveClientId(newCode);
        // resolveClientId uses code as name on insert; rename to the original prefix.
        await query(
          "update clients set name = $1 where id = $2 and name = $3",
          [newName, clientId, newCode]
        );
        clientCode = newCode.toUpperCase();
        clientSlug = slugify(newName);
        process.stdout.write(`  auto-created client: ${newCode} (${newName}) for bc2 ${bc2Project.id}\n`);
        summary.autoCreatedClients.push({ code: newCode, name: newName, bc2Id: bc2Project.id });
      } else {
        // matchedBy === "none". Orphan path.
        if (!flags.allowOrphans) {
          orphans.push({
            bc2Id: bc2Project.id,
            name: bc2Project.name,
            archived: bc2Project.archived === true,
            createdAt: bc2Project.created_at
          });
          process.stderr.write(`  skipped orphan: bc2 ${bc2Project.id} "${bc2Project.name}"\n`);
          continue;
        }
        clientId = null;
        clientCode = "";
        clientSlug = "unassigned";
      }

      // project_seq: integer prefix of num. Variants share seq.
      let projectSeq: number | null = null;
      if (num) {
        const numPrefixMatch = num.match(/^(\d+)/);
        projectSeq = numPrefixMatch ? parseInt(numPrefixMatch[1], 10) : null;
      } else if (clientId !== null) {
        const seqRow = await query<{ next_seq: number }>(
          "select coalesce(max(project_seq), 0) + 1 as next_seq from projects where client_id is not distinct from $1",
          [clientId]
        );
        projectSeq = seqRow.rows[0]?.next_seq ?? null;
      }

      // project_code: only when we have a client + num. Variants get a/b/c suffix.
      const baseProjectCode = clientId !== null && num
        ? `${clientCode}-${num}`
        : null;
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

      const created = await query(
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
          projectUpdatedAt
        ]
      );
      const localId = created.rows[0].id as string;

      await query(
        "insert into import_map_projects (basecamp_project_id, local_project_id) values ($1,$2)",
        [String(bc2Project.id), localId]
      );
      await logRecord(jobId, "project", String(bc2Project.id), "success");
      await incrementCounters(jobId, 1, 0);
      projects.push({ bc2Id: bc2Project.id, localId, name: bc2Project.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  project ${bc2Project.id} (${bc2Project.name}) FAILED: ${msg}\n`);
      await logRecord(jobId, "project", String(bc2Project.id), "failed", msg);
      await incrementCounters(jobId, 0, 1);
    }
  }

  process.stdout.write(`  ${projects.length} projects resolved\n`);

  // ── Write orphan CSV + summary JSON ──
  const fs = await import("fs/promises");
  const path = await import("path");
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const csvEsc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const orphanLines = ["bc2_id,raw_title,archived,created_at"];
  for (const o of orphans) {
    orphanLines.push([String(o.bc2Id), csvEsc(o.name), String(o.archived), o.createdAt].join(","));
  }
  const orphanPath = path.join(tmpDir, "bc2-import-orphans.csv");
  await fs.writeFile(orphanPath, orphanLines.join("\n") + "\n", "utf-8");

  const summaryOut = {
    generated_at: new Date().toISOString(),
    total_bc2_projects: allBc2Projects.length,
    matched_by: summary.matchedBy,
    auto_created_clients: summary.autoCreatedClients,
    dup_suffixes_assigned: summary.dupSuffixesAssigned,
    orphans_count: orphans.length,
    orphan_csv: orphanPath
  };
  const summaryPath = path.join(tmpDir, "bc2-import-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summaryOut, null, 2), "utf-8");

  process.stdout.write(`\nWrote orphans CSV (${orphans.length} rows): ${orphanPath}\n`);
  process.stdout.write(`Wrote import summary: ${summaryPath}\n`);

  return projects;
}

// ── Files phase ───────────────────────────────────────────────────────────────

const CONCURRENCY = 1;

async function migrateFiles(
  jobId: string,
  fetcher: Bc2Fetcher,
  client: Bc2Client,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode,
  includeFiles: boolean,
  downloadEnv: Bc2DownloadEnv
): Promise<{ imported: number; skipped: number }> {
  if (!includeFiles || mode === "dry") {
    if (mode === "dry") {
      process.stdout.write("Files phase skipped (dry mode)\n");
    } else {
      process.stdout.write("Files phase skipped (--files not set)\n");
    }
    return { imported: 0, skipped: 0 };
  }

  const adapter = new DropboxStorageAdapter();
  let imported = 0;
  let skipped = 0;

  process.stdout.write("Migrating files...\n");

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];

    // Fetch project record to get storage dir fields
    const projectRow = await query(
      "select id, storage_project_dir, client_slug, project_slug, project_code, archived from projects where id = $1",
      [project.localId]
    );
    if (!projectRow.rows[0]) {
      process.stderr.write(`  project ${project.localId} not found in DB, skipping files\n`);
      continue;
    }
    const projectRecord = projectRow.rows[0] as Record<string, unknown>;
    // Use DB `storage_project_dir` when set so Dropbox uploads match project folders (multi-segment roots).
    const storageDir = getProjectStorageDir(projectRecord);

    // Collect attachments into a queue for batched concurrency
    const attachmentQueue: Bc2Attachment[] = [];
    for await (const attachment of fetcher.fetchAttachments(String(project.bc2Id))) {
      attachmentQueue.push(attachment);
    }

    let projectImported = 0;
    let projectSkipped = 0;

    // Process in batches of CONCURRENCY
    for (let batchStart = 0; batchStart < attachmentQueue.length; batchStart += CONCURRENCY) {
      const batch = attachmentQueue.slice(batchStart, batchStart + CONCURRENCY);

      await Promise.all(batch.map(async (attachment) => {
        let { threadId, commentId } = await resolveBc2AttachmentLinkage(query, attachment);

        // `/attachments.json` can return incomplete attachable payloads.
        // Fall back to attachment detail before importing discussion-linked files.
        if (!threadId && !commentId) {
          try {
            const detail = await client.get<Bc2Attachment>(
              `/projects/${project.bc2Id}/attachments/${attachment.id}.json`
            );
            const resolved = await resolveBc2LinkageFromAttachable(query, detail.body.attachable);
            threadId = resolved.threadId;
            commentId = resolved.commentId;
          } catch (error) {
            process.stderr.write(
              `  warning: could not fetch attachment detail for ${attachment.id}: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            );
          }
        }

        const attachableType = attachment.attachable?.type?.trim().toLowerCase() ?? "";
        const isDiscussionAttachable = attachableType === "message" || attachableType === "comment";
        if (isDiscussionAttachable && !threadId && !commentId) {
          process.stderr.write(
            `  skip ${attachment.id} (${attachment.name}): unresolved ${attachment.attachable?.type} linkage\n`
          );
          projectSkipped++;
          skipped++;
          return;
        }

        const result = await importBc2FileFromAttachment({
          query,
          jobId,
          projectLocalId: project.localId,
          storageDir,
          personMap,
          attachment,
          threadId,
          commentId,
          downloadEnv,
          adapter,
          createFileMetadata,
          logRecord,
          incrementCounters,
          projectArchived: Boolean(projectRecord.archived),
          onDownload429: (id, waitMs) => {
            process.stderr.write(
              `  download 429 — waiting ${waitMs / 1000}s (attachment ${id})\n`
            );
          }
        });
        if (result.status === "failed") {
          process.stderr.write(
            `  file ${attachment.id} (${attachment.name}) FAILED: ${result.error}\n`
          );
        } else if (result.status === "imported") {
          projectImported++;
          imported++;
        } else {
          projectSkipped++;
          skipped++;
        }
      }));
    }

    process.stdout.write(
      `  [${pad(i + 1, projects.length)}/${projects.length}] ${project.name}  ${projectImported} imported, ${projectSkipped} skipped (already present)\n`
    );
  }

  process.stdout.write(
    `Files phase: ${imported} imported, ${skipped} skipped (existing BC attachment / map)\n`
  );
  return { imported, skipped };
}

// ── Threads and comments phase ────────────────────────────────────────────────

async function migrateThreadsAndComments(
  jobId: string,
  fetcher: Bc2Fetcher,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode,
  includeFiles: boolean,
  downloadEnv: Bc2DownloadEnv
): Promise<{ threadCount: number; commentCount: number }> {
  let threadCount = 0;
  let commentCount = 0;

  process.stdout.write("Migrating threads and comments...\n");

  const fileAdapter =
    includeFiles && mode !== "dry" ? new DropboxStorageAdapter() : null;

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    let projectThreads = 0;
    let projectComments = 0;

    let storageDirForCommentFiles: string | null = null;
    let projectArchivedForFiles = false;
    if (fileAdapter) {
      const projectRow = await query(
        "select id, storage_project_dir, client_slug, project_slug, project_code, archived from projects where id = $1",
        [project.localId]
      );
      if (projectRow.rows[0]) {
        const row = projectRow.rows[0] as Record<string, unknown>;
        storageDirForCommentFiles = getProjectStorageDir(row);
        projectArchivedForFiles = Boolean(row.archived);
      }
    }

    try {
    for await (const message of fetcher.fetchMessages(String(project.bc2Id))) {
      try {
        let localThreadId: string;

        if (mode !== "dry") {
          // Idempotency: check map
          const existing = await query(
            "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
            [String(message.id)]
          );
          if (existing.rows[0]) {
            localThreadId = existing.rows[0].local_thread_id as string;
          } else {
            const authorUserId = personMap.get(message.creator.id) ?? `dry_${message.creator.id}`;
            const thread = await createThread({
              projectId: project.localId,
              title: message.subject,
              bodyMarkdown: message.content ?? "",
              authorUserId,
              sourceCreatedAt: parseBc2IsoTimestamptz(message.created_at) ?? undefined
            });
            localThreadId = thread.id as string;
            await query(
              "insert into import_map_threads (basecamp_thread_id, local_thread_id) values ($1,$2)",
              [String(message.id), localThreadId]
            );
            await logRecord(jobId, "thread", String(message.id), "success");
            await incrementCounters(jobId, 1, 0);
          }
        } else {
          localThreadId = `dry_thread_${message.id}`;
        }

        projectThreads++;
        threadCount++;

        if (
          fileAdapter &&
          storageDirForCommentFiles &&
          (message.attachments?.length ?? 0) > 0
        ) {
          for (const att of message.attachments ?? []) {
            const fileResult = await importBc2FileFromAttachment({
              query,
              jobId,
              projectLocalId: project.localId,
              storageDir: storageDirForCommentFiles,
              personMap,
              attachment: att,
              threadId: localThreadId,
              commentId: null,
              downloadEnv,
              adapter: fileAdapter,
              createFileMetadata,
              logRecord,
              incrementCounters,
              projectArchived: projectArchivedForFiles,
              onDownload429: (id, waitMs) => {
                process.stderr.write(
                  `  download 429 — waiting ${waitMs / 1000}s (attachment ${id})\n`
                );
              }
            });
            if (fileResult.status === "failed") {
              process.stderr.write(
                `  message ${message.id} attachment ${att.id} FAILED: ${fileResult.error}\n`
              );
            }
          }
        }

        // Migrate comments — embedded in the individual message response
        for (const comment of (message.comments ?? [])) {
          try {
            let localCommentId: string | null = null;
            if (mode !== "dry") {
              const existingComment = await query(
                "select local_comment_id from import_map_comments where basecamp_comment_id = $1",
                [String(comment.id)]
              );
              if (!existingComment.rows[0]) {
                const authorUserId = personMap.get(comment.creator.id) ?? `dry_${comment.creator.id}`;
                const created = await createComment({
                  projectId: project.localId,
                  threadId: localThreadId,
                  bodyMarkdown: comment.content ?? "",
                  authorUserId,
                  sourceCreatedAt: parseBc2IsoTimestamptz(comment.created_at) ?? undefined
                });
                localCommentId = created.id as string;
                await query(
                  "insert into import_map_comments (basecamp_comment_id, local_comment_id) values ($1,$2)",
                  [String(comment.id), localCommentId]
                );
                await logRecord(jobId, "comment", String(comment.id), "success");
                await incrementCounters(jobId, 1, 0);
              } else {
                localCommentId = existingComment.rows[0].local_comment_id as string;
              }

              if (
                fileAdapter &&
                storageDirForCommentFiles &&
                localCommentId &&
                (comment.attachments?.length ?? 0) > 0
              ) {
                for (const att of comment.attachments ?? []) {
                  const fileResult = await importBc2FileFromAttachment({
                    query,
                    jobId,
                    projectLocalId: project.localId,
                    storageDir: storageDirForCommentFiles,
                    personMap,
                    attachment: att,
                    threadId: localThreadId,
                    commentId: localCommentId,
                    downloadEnv,
                    adapter: fileAdapter,
                    createFileMetadata,
                    logRecord,
                    incrementCounters,
                    projectArchived: projectArchivedForFiles,
                    onDownload429: (id, waitMs) => {
                      process.stderr.write(
                        `  download 429 — waiting ${waitMs / 1000}s (attachment ${id})\n`
                      );
                    }
                  });
                  if (fileResult.status === "failed") {
                    process.stderr.write(
                      `  comment ${comment.id} attachment ${att.id} FAILED: ${fileResult.error}\n`
                    );
                  }
                }
              }
            }
            projectComments++;
            commentCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`  comment ${comment.id} FAILED: ${msg}\n`);
            if (mode !== "dry") {
              await logRecord(jobId, "comment", String(comment.id), "failed", msg);
              await incrementCounters(jobId, 0, 1);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  thread ${message.id} FAILED: ${msg}\n`);
        if (mode !== "dry") {
          await logRecord(jobId, "thread", String(message.id), "failed", msg);
          await incrementCounters(jobId, 0, 1);
        }
      }
    }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [${project.name}] messages unavailable — skipping (${msg})\n`);
    }

    process.stdout.write(
      `  [${pad(i + 1, projects.length)}/${projects.length}] ${project.name}  ${projectThreads} threads  ${projectComments} comments\n`
    );
  }

  return { threadCount, commentCount };
}

// ── DB loaders for --only-files ───────────────────────────────────────────────

async function loadProjectsFromDB(flags: CliFlags): Promise<MigratedProject[]> {
  const result = await query<{ basecamp_project_id: string; local_project_id: string; name: string; archived: boolean }>(
    `select imp.basecamp_project_id, imp.local_project_id, p.name, p.archived
       from import_map_projects imp
       join projects p on p.id = imp.local_project_id
       order by p.name`
  );
  let rows = result.rows;

  if (flags.fromProject) {
    const prefix = flags.fromProject.toLowerCase();
    rows = rows.filter(r => r.name.toLowerCase().startsWith(prefix));
  }

  if (flags.mode === "limited") {
    rows = rows.slice(0, flags.limit);
  }

  return rows.map(row => ({
    bc2Id: parseInt(row.basecamp_project_id, 10),
    localId: row.local_project_id,
    name: row.name
  }));
}

async function loadPersonMapFromDB(): Promise<Map<number, string>> {
  const result = await query<{ basecamp_person_id: string; local_user_profile_id: string }>(
    "select basecamp_person_id, local_user_profile_id from import_map_people"
  );
  const map = new Map<number, string>();
  for (const row of result.rows) {
    map.set(parseInt(row.basecamp_person_id, 10), row.local_user_profile_id);
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags();

  const accountId   = requireEnv("BASECAMP_ACCOUNT_ID");
  const username    = requireEnv("BASECAMP_USERNAME");
  const password    = requireEnv("BASECAMP_PASSWORD");
  const userAgent   = requireEnv("BASECAMP_USER_AGENT");
  const delayMs     = parseInt(process.env.BASECAMP_REQUEST_DELAY_MS ?? "200", 10);

  const client  = new Bc2Client({ accountId, username, password, userAgent, requestDelayMs: delayMs });
  const fetcher = new Bc2Fetcher(client);

  const downloadEnv: Bc2DownloadEnv = { username, password, userAgent };

  const modeLabel = flags.mode === "dry" ? " (dry)" : flags.mode === "limited" ? ` (limited: ${flags.limit})` : "";
  const onlyFilesLabel = flags.onlyFiles ? " [only-files]" : "";
  console.log(
    `[BC2 Migration] mode=${flags.mode}${modeLabel} projects=${flags.projectSource}${onlyFilesLabel}`
  );

  const jobId = flags.mode !== "dry"
    ? await createMigrationJob({
        mode: flags.mode,
        limit: flags.limit,
        files: flags.files || flags.onlyFiles,
        onlyFiles: flags.onlyFiles,
        projectSource: flags.projectSource
      })
    : "dry-run";

  // SIGINT: mark job interrupted and exit
  process.on("SIGINT", async () => {
    console.log("\n[Interrupted — marking job as interrupted]");
    if (jobId !== "dry-run") {
      await finishJob(jobId, "interrupted").catch(() => {});
    }
    process.exit(0);
  });

  let personMap: Map<number, string>;
  let projects: MigratedProject[];
  let threadCount = 0;
  let commentCount = 0;

  if (flags.onlyFiles) {
    process.stdout.write("Loading projects and people from DB (--only-files)...\n");
    [projects, personMap] = await Promise.all([loadProjectsFromDB(flags), loadPersonMapFromDB()]);
    process.stdout.write(`  ${projects.length} projects, ${personMap.size} people loaded\n`);
  } else {
    personMap = await migratePeople(jobId, fetcher, flags.mode);
    projects   = await migrateProjects(jobId, fetcher, personMap, flags);
    ({ threadCount, commentCount } = await migrateThreadsAndComments(
      jobId,
      fetcher,
      projects,
      personMap,
      flags.mode,
      flags.files || flags.onlyFiles,
      downloadEnv
    ));
  }

  const { imported: filesImported, skipped: filesSkipped } = await migrateFiles(
    jobId,
    fetcher,
    client,
    projects,
    personMap,
    flags.mode,
    flags.files || flags.onlyFiles,
    downloadEnv
  );

  if (jobId !== "dry-run") {
    await finishJob(jobId, "completed");
  }
  console.log(
    `\nDone — ${projects.length} projects, ${threadCount} threads, ${commentCount} comments, ${filesImported} files imported, ${filesSkipped} files skipped (job_id=${jobId})`
  );
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
