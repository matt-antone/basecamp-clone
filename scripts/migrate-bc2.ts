#!/usr/bin/env npx tsx
// scripts/migrate-bc2.ts

import { Pool, type QueryResultRow } from "pg";
import { Bc2Client } from "../lib/imports/bc2-client";
import { Bc2Fetcher } from "../lib/imports/bc2-fetcher";
import {
  parseProjectTitle,
  resolveClientId,
  resolvePerson
} from "../lib/imports/bc2-transformer";
import { createThread, createComment } from "../lib/repositories";

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
  fromProject: string | null;
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

  return {
    mode: rawMode as RunMode,
    limit: parseInt(get("limit") ?? "5", 10),
    files: has("files"),
    fromProject: get("from-project")
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
  for await (const bc2Project of fetcher.fetchProjects()) {
    if (flags.mode === "limited" && count >= flags.limit) break;
    if (flags.fromProject && !bc2Project.name.startsWith(flags.fromProject)) {
      continue;
    }

    count++;
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

      const projectNumber = num ? num.padStart(4, "0") : "0000";
      const codeSlug = code ? code.toUpperCase() : "UNK";
      const projectCode = `${codeSlug}-${projectNumber}`;

      const created = await query(
        `insert into projects (name, description, client_id, archived, code)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [
          title,
          bc2Project.description ?? null,
          clientId,
          bc2Project.archived,
          projectCode
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

// ── Threads and comments phase ────────────────────────────────────────────────

async function migrateThreadsAndComments(
  jobId: string,
  fetcher: Bc2Fetcher,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode
): Promise<{ threadCount: number; commentCount: number }> {
  let threadCount = 0;
  let commentCount = 0;

  process.stdout.write("Migrating threads and comments...\n");

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    let projectThreads = 0;
    let projectComments = 0;

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
              authorUserId
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

        // Migrate comments for this message
        for await (const comment of fetcher.fetchComments(String(project.bc2Id), String(message.id))) {
          try {
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
                  authorUserId
                });
                await query(
                  "insert into import_map_comments (basecamp_comment_id, local_comment_id) values ($1,$2)",
                  [String(comment.id), created.id as string]
                );
                await logRecord(jobId, "comment", String(comment.id), "success");
                await incrementCounters(jobId, 1, 0);
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

    process.stdout.write(
      `  [${pad(i + 1, projects.length)}/${projects.length}] ${project.name}  ${projectThreads} threads  ${projectComments} comments\n`
    );
  }

  return { threadCount, commentCount };
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

  const modeLabel = flags.mode === "dry" ? " (dry)" : flags.mode === "limited" ? ` (limited: ${flags.limit})` : "";
  console.log(`[BC2 Migration] mode=${flags.mode}${modeLabel}`);

  const jobId = flags.mode !== "dry"
    ? await createMigrationJob({ mode: flags.mode, limit: flags.limit, files: flags.files })
    : "dry-run";

  // SIGINT: mark job interrupted and exit
  process.on("SIGINT", async () => {
    console.log("\n[Interrupted — marking job as interrupted]");
    if (jobId !== "dry-run") {
      await finishJob(jobId, "interrupted").catch(() => {});
    }
    process.exit(0);
  });

  const personMap = await migratePeople(jobId, fetcher, flags.mode);
  const projects   = await migrateProjects(jobId, fetcher, personMap, flags);

  const { threadCount, commentCount } = await migrateThreadsAndComments(
    jobId, fetcher, projects, personMap, flags.mode
  );

  // Task 9 will call migrateFiles here

  if (jobId !== "dry-run") {
    await finishJob(jobId, "completed");
  }
  console.log(
    `\nDone — ${projects.length} projects, ${threadCount} threads, ${commentCount} comments (job_id=${jobId})`
  );
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
