/**
 * BC2 full dump — JSON-only mirror of a Basecamp 2 account.
 *
 * Reads BASECAMP_USERNAME/BASECAMP_PASSWORD/BC2_ACCOUNT_ID/BC2_USER_AGENT
 * from .env.local. Writes to BASECAMP_DUMP_DIR (default
 * /Volumes/Spare/basecamp-dump). Resumable: skips files that already exist
 * non-empty. No binary attachment downloads — metadata only.
 *
 * Usage:
 *   pnpm tsx scripts/dump-bc2.ts                       # full dump
 *   pnpm tsx scripts/dump-bc2.ts --project=12345678    # single project
 *   pnpm tsx scripts/dump-bc2.ts --limit=5             # first 5 projects
 *   pnpm tsx scripts/dump-bc2.ts --skip-archived
 *   pnpm tsx scripts/dump-bc2.ts --concurrency=4
 */

import { config } from "dotenv";
import { resolve } from "path";
import { promises as fs } from "fs";
import * as path from "path";
import { Bc2Client, type Bc2Response } from "../lib/imports/bc2-client";

config({ path: resolve(process.cwd(), ".env.local") });

const DUMP_DIR = process.env.BASECAMP_DUMP_DIR ?? "/Volumes/Spare/basecamp-dump";

interface CliFlags {
  project: string | null;
  limit: number | null;
  skipArchived: boolean;
  skipActive: boolean;
  concurrency: number;
  force: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    project: null,
    limit: null,
    skipArchived: false,
    skipActive: false,
    concurrency: 4,
    force: false,
  };
  for (const a of args) {
    if (a.startsWith("--project=")) flags.project = a.slice("--project=".length);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--skip-archived") flags.skipArchived = true;
    else if (a === "--skip-active") flags.skipActive = true;
    else if (a.startsWith("--concurrency=")) flags.concurrency = Number.parseInt(a.slice("--concurrency=".length), 10);
    else if (a === "--force") flags.force = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function fileExistsNonEmpty(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile() && st.size > 2;
  } catch {
    return false;
  }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function fetchPaginated<T>(client: Bc2Client, firstPath: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = firstPath;
  while (next) {
    const res: Bc2Response<T[]> = await client.get<T[]>(next);
    if (Array.isArray(res.body)) out.push(...res.body);
    next = res.nextUrl;
  }
  return out;
}

interface Bc2ProjectSummary {
  id: number;
  name: string;
  archived?: boolean;
  [k: string]: unknown;
}

interface Bc2TopicSummary {
  id: number;
  title?: string;
  topicable: { id: number; type: string };
  [k: string]: unknown;
}

const TOPIC_TYPE_TO_PATH: Record<string, string> = {
  Message: "messages",
  Todolist: "todolists",
  "CalendarEvent": "calendar_events",
  Calendar: "calendar_events",
  Upload: "uploads",
  Document: "documents",
};

interface Counters {
  projects: number;
  topics: number;
  topicDetails: number;
  topicSkipped: number;
  attachments: number;
  errors: number;
  startedAt: string;
}

const counters: Counters = {
  projects: 0,
  topics: 0,
  topicDetails: 0,
  topicSkipped: 0,
  attachments: 0,
  errors: 0,
  startedAt: new Date().toISOString(),
};

const errors: { project?: number; path: string; message: string }[] = [];

async function dumpProject(
  client: Bc2Client,
  project: Bc2ProjectSummary,
  flags: CliFlags,
): Promise<void> {
  const projectDir = path.join(DUMP_DIR, "by-project", String(project.id));
  await ensureDir(projectDir);

  const projectFile = path.join(projectDir, "project.json");
  if (flags.force || !(await fileExistsNonEmpty(projectFile))) {
    await writeJson(projectFile, project);
  }

  // Topics index — paginated.
  const topicsFile = path.join(projectDir, "topics.json");
  let topics: Bc2TopicSummary[];
  if (!flags.force && (await fileExistsNonEmpty(topicsFile))) {
    topics = await readJson<Bc2TopicSummary[]>(topicsFile);
  } else {
    try {
      topics = await fetchPaginated<Bc2TopicSummary>(
        client,
        `/projects/${project.id}/topics.json`,
      );
      await writeJson(topicsFile, topics);
    } catch (err) {
      counters.errors++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ project: project.id, path: `/projects/${project.id}/topics.json`, message });
      console.warn(`  ! topics fail project=${project.id}: ${message}`);
      return;
    }
  }
  counters.topics += topics.length;

  // Topic details — by topicable.type → endpoint.
  for (const topic of topics) {
    const t = topic.topicable;
    if (!t || !t.type) continue;
    const segment = TOPIC_TYPE_TO_PATH[t.type];
    if (!segment) {
      counters.topicSkipped++;
      continue;
    }
    const detailFile = path.join(projectDir, segment, `${t.id}.json`);
    if (!flags.force && (await fileExistsNonEmpty(detailFile))) {
      counters.topicDetails++;
      continue;
    }
    try {
      const res = await client.get<unknown>(`/projects/${project.id}/${segment}/${t.id}.json`);
      await writeJson(detailFile, res.body);
      counters.topicDetails++;
    } catch (err) {
      counters.errors++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        project: project.id,
        path: `/projects/${project.id}/${segment}/${t.id}.json`,
        message,
      });
      console.warn(`  ! topic fail project=${project.id} ${segment}/${t.id}: ${message}`);
    }
  }

  // Attachments — paginated. Metadata only.
  const attachmentsFile = path.join(projectDir, "attachments.json");
  if (flags.force || !(await fileExistsNonEmpty(attachmentsFile))) {
    try {
      const attachments = await fetchPaginated<unknown>(
        client,
        `/projects/${project.id}/attachments.json`,
      );
      await writeJson(attachmentsFile, attachments);
      counters.attachments += attachments.length;
    } catch (err) {
      counters.errors++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        project: project.id,
        path: `/projects/${project.id}/attachments.json`,
        message,
      });
      console.warn(`  ! attachments fail project=${project.id}: ${message}`);
    }
  } else {
    const existing = await readJson<unknown[]>(attachmentsFile);
    counters.attachments += existing.length;
  }

  counters.projects++;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    runners.push((async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
}

async function writeManifest(): Promise<void> {
  const manifest = {
    ...counters,
    finishedAt: new Date().toISOString(),
    errorCount: errors.length,
    dumpDir: DUMP_DIR,
  };
  await writeJson(path.join(DUMP_DIR, "manifest.json"), manifest);
  if (errors.length) {
    await writeJson(path.join(DUMP_DIR, "errors.json"), errors);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();

  const accountId = process.env.BASECAMP_ACCOUNT_ID ?? requireEnv("BC2_ACCOUNT_ID");
  const username = requireEnv("BASECAMP_USERNAME");
  const password = requireEnv("BASECAMP_PASSWORD");
  const userAgent = process.env.BASECAMP_USER_AGENT ?? requireEnv("BC2_USER_AGENT");

  await ensureDir(DUMP_DIR);

  const client = new Bc2Client({
    accountId,
    username,
    password,
    userAgent,
    requestDelayMs: 200,
  });

  console.log(`[dump-bc2] dest=${DUMP_DIR} concurrency=${flags.concurrency} force=${flags.force}`);

  // People — single endpoint.
  const peopleFile = path.join(DUMP_DIR, "people.json");
  if (flags.force || !(await fileExistsNonEmpty(peopleFile))) {
    console.log("[dump-bc2] people.json …");
    const people = await fetchPaginated<unknown>(client, "/people.json");
    await writeJson(peopleFile, people);
    console.log(`[dump-bc2] people: ${people.length}`);
  }

  // Projects — active + archived.
  let projects: Bc2ProjectSummary[] = [];

  if (!flags.skipActive) {
    const activeFile = path.join(DUMP_DIR, "projects", "active.json");
    let active: Bc2ProjectSummary[];
    if (!flags.force && (await fileExistsNonEmpty(activeFile))) {
      active = await readJson<Bc2ProjectSummary[]>(activeFile);
    } else {
      console.log("[dump-bc2] projects/active …");
      active = await fetchPaginated<Bc2ProjectSummary>(client, "/projects.json");
      await writeJson(activeFile, active);
    }
    console.log(`[dump-bc2] active: ${active.length}`);
    projects.push(...active);
  }

  if (!flags.skipArchived) {
    const archivedFile = path.join(DUMP_DIR, "projects", "archived.json");
    let archived: Bc2ProjectSummary[];
    if (!flags.force && (await fileExistsNonEmpty(archivedFile))) {
      archived = await readJson<Bc2ProjectSummary[]>(archivedFile);
    } else {
      console.log("[dump-bc2] projects/archived …");
      archived = await fetchPaginated<Bc2ProjectSummary>(client, "/projects/archived.json");
      await writeJson(archivedFile, archived);
    }
    console.log(`[dump-bc2] archived: ${archived.length}`);
    projects.push(...archived);
  }

  if (flags.project) {
    const id = Number.parseInt(flags.project, 10);
    projects = projects.filter(p => p.id === id);
    if (!projects.length) {
      throw new Error(`Project ${flags.project} not found in active or archived list`);
    }
  }

  if (flags.limit && flags.limit > 0) {
    projects = projects.slice(0, flags.limit);
  }

  console.log(`[dump-bc2] dumping ${projects.length} project(s)`);

  let done = 0;
  await runWithConcurrency(projects, flags.concurrency, async (project) => {
    const start = Date.now();
    try {
      await dumpProject(client, project, flags);
      done++;
      const ms = Date.now() - start;
      console.log(
        `  [${done}/${projects.length}] ${project.id} "${(project.name ?? "").slice(0, 40)}" — ` +
        `topics=${counters.topics} details=${counters.topicDetails} att=${counters.attachments} ` +
        `(${ms}ms)`,
      );
    } catch (err) {
      counters.errors++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ project: project.id, path: `project ${project.id}`, message });
      console.error(`  ! project fail ${project.id}: ${message}`);
    }
    if (done % 25 === 0) await writeManifest();
  });

  await writeManifest();

  console.log(
    `[dump-bc2] done. projects=${counters.projects} topics=${counters.topics} ` +
    `details=${counters.topicDetails} skipped=${counters.topicSkipped} ` +
    `attachments=${counters.attachments} errors=${counters.errors}`,
  );
  if (counters.errors > 0) {
    console.log(`[dump-bc2] see ${path.join(DUMP_DIR, "errors.json")}`);
  }
}

main().catch(err => {
  console.error("[dump-bc2] fatal:", err);
  process.exit(1);
});
