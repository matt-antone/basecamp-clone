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
  type Bc2ProjectSource
} from "../lib/imports/bc2-fetcher";
import type { Bc2DownloadEnv } from "../lib/imports/bc2-attachment-download";
import { importBc2FileFromAttachment } from "../lib/imports/bc2-migrate-single-file";
import {
  parseProjectTitle,
  resolveClientId,
  resolvePerson
} from "../lib/imports/bc2-transformer";
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
    projectSource: rawProjects as Bc2ProjectSource
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

  let count = 0;
  for await (const bc2Project of fetcher.fetchProjects({ source: flags.projectSource })) {
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

      const { code, num, title } = parseProjectTitle(bc2Project.name);
      const clientId = code ? await resolveClientId(code) : null;

      // Compute all NOT NULL derived fields required by the schema
      const slugify = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";

      // Resolve client code + name for slug/project_code generation
      let clientCode = "GEN";
      let clientSlug = "unassigned";
      if (clientId) {
        const clientRow = await query<{ code: string; name: string }>(
          "select code, name from clients where id = $1",
          [clientId]
        );
        if (clientRow.rows[0]) {
          clientCode = clientRow.rows[0].code.toUpperCase();
          clientSlug = slugify(clientRow.rows[0].name);
        }
      }

      // project_seq: use parsed num if available, else next seq for this client
      let projectSeq: number;
      if (num) {
        projectSeq = parseInt(num, 10);
      } else {
        const seqRow = await query<{ next_seq: number }>(
          "select coalesce(max(project_seq), 0) + 1 as next_seq from projects where client_id is not distinct from $1",
          [clientId]
        );
        projectSeq = seqRow.rows[0].next_seq;
      }

      const projectCode = `${clientCode}-${String(projectSeq).padStart(4, "0")}`;
      const projectSlug = slugify(title);
      const folderName = `${projectCode}-${sanitizeDropboxFolderTitle(title)}`;
      const projectsRoot = dropboxProjectsRootFromEnv();
      const storageDir = bc2Project.archived
        ? `${projectsRoot}/${clientCode}/_Archive/${folderName}`
        : `${projectsRoot}/${clientCode}/${folderName}`;
      // slug is the unique URL identifier; use project_code in lowercase
      const urlSlug = projectCode.toLowerCase();

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
  return projects;
}

// ── Files phase ───────────────────────────────────────────────────────────────

const CONCURRENCY = 1;

async function migrateFiles(
  jobId: string,
  fetcher: Bc2Fetcher,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode,
  includeFiles: boolean,
  downloadEnv: Bc2DownloadEnv
): Promise<number> {
  if (!includeFiles || mode === "dry") {
    if (mode === "dry") {
      process.stdout.write("Files phase skipped (dry mode)\n");
    } else {
      process.stdout.write("Files phase skipped (--files not set)\n");
    }
    return 0;
  }

  const adapter = new DropboxStorageAdapter();
  let fileCount = 0;

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

    let projectFileCount = 0;

    // Process in batches of CONCURRENCY
    for (let batchStart = 0; batchStart < attachmentQueue.length; batchStart += CONCURRENCY) {
      const batch = attachmentQueue.slice(batchStart, batchStart + CONCURRENCY);

      await Promise.all(batch.map(async (attachment) => {
        const result = await importBc2FileFromAttachment({
          query,
          jobId,
          projectLocalId: project.localId,
          storageDir,
          personMap,
          attachment,
          threadId: null,
          commentId: null,
          downloadEnv,
          adapter,
          createFileMetadata,
          logRecord,
          incrementCounters,
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
        } else {
          projectFileCount++;
          fileCount++;
        }
      }));
    }

    process.stdout.write(
      `  [${pad(i + 1, projects.length)}/${projects.length}] ${project.name}  ${projectFileCount} files\n`
    );
  }

  return fileCount;
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
    if (fileAdapter) {
      const projectRow = await query(
        "select id, storage_project_dir, client_slug, project_slug, project_code, archived from projects where id = $1",
        [project.localId]
      );
      if (projectRow.rows[0]) {
        storageDirForCommentFiles = getProjectStorageDir(
          projectRow.rows[0] as Record<string, unknown>
        );
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

  const fileCount = await migrateFiles(
    jobId,
    fetcher,
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
    `\nDone — ${projects.length} projects, ${threadCount} threads, ${commentCount} comments, ${fileCount} files (job_id=${jobId})`
  );
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
