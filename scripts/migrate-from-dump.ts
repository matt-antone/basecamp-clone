// scripts/migrate-from-dump.ts
//
// Entry point for the dump-first migration flow. Reads the static BC2 dump on
// disk and falls back to the live API only when the dump is missing or marked
// errored. Mirrors the structure of scripts/migrate-bc2.ts but consumes the
// new lib/imports/migration/* phase modules.
//
// Dry-run handling:
//   --dry-run wraps the pg query so non-SELECT statements no-op. createImportJob
//   inserts, so under --dry-run we skip job creation entirely and use a fake
//   jobId of `dryrun-<timestamp>`. Phase modules will pass that jobId into
//   their (suppressed) writes; SELECTs still run against the real DB.
//
// Known-clients loader:
//   Pulls id/code/name from the clients table via realQ so resolveTitle can
//   match codes. Pass --no-known-clients to skip the DB load (resolver still
//   works on free-text titles, just without code matches).

import { config } from "dotenv";
import { resolve } from "path";
import { promises as fs } from "fs";
import * as path from "path";
import { Pool, type QueryResultRow } from "pg";
import { Bc2Client } from "../lib/imports/bc2-client";
import { createDumpReader } from "../lib/imports/dump-reader";
import {
  createImportJob,
  finishJob,
  incrementCounters,
  type Query,
} from "../lib/imports/migration/jobs";
import { migratePeople } from "../lib/imports/migration/people";
import { migrateProjects } from "../lib/imports/migration/projects";
import { migrateThreadsAndComments } from "../lib/imports/migration/threads";
import { migrateFiles } from "../lib/imports/migration/files";
import type { KnownClient } from "../lib/imports/bc2-client-resolver";
import type { CliFlags, MigratedProject } from "../lib/imports/migration/types";

config({ path: resolve(process.cwd(), ".env.local") });

interface ExtraFlags {
  noKnownClients: boolean;
}

function parseFlags(): CliFlags & ExtraFlags {
  const argv = process.argv.slice(2);
  const flags: CliFlags & ExtraFlags = {
    phase: "all",
    projects: "all",
    limit: null,
    projectId: null,
    dumpDir: process.env.BASECAMP_DUMP_DIR ?? "/Volumes/Spare/basecamp-dump",
    dryRun: false,
    noFiles: false,
    noKnownClients: false,
  };
  for (const a of argv) {
    if (a.startsWith("--phase=")) flags.phase = a.slice(8) as CliFlags["phase"];
    else if (a.startsWith("--projects=")) flags.projects = a.slice(11) as CliFlags["projects"];
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice(8), 10);
    else if (a.startsWith("--project-id=")) flags.projectId = Number.parseInt(a.slice(13), 10);
    else if (a.startsWith("--dump-dir=")) flags.dumpDir = a.slice(11);
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--no-files") flags.noFiles = true;
    else if (a === "--no-known-clients") flags.noKnownClients = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function loadErrorsSet(dumpDir: string): Promise<Set<string>> {
  const p = path.join(dumpDir, "errors.json");
  try {
    const buf = await fs.readFile(p, "utf8");
    const arr = JSON.parse(buf) as Array<{ path: string }>;
    const set = new Set<string>();
    for (const e of arr) {
      const m = e.path.match(/^\/projects\/(\d+)\/(.+)$/);
      if (m) set.add(`by-project/${m[1]}/${m[2]}`);
      else if (e.path === "/projects.json") set.add("projects/active.json");
      else if (e.path === "/projects/archived.json") set.add("projects/archived.json");
      else if (e.path === "/people.json") set.add("people.json");
    }
    return set;
  } catch {
    return new Set();
  }
}

async function loadPersonMap(q: Query): Promise<Map<number, string>> {
  const r = await q<{ basecamp_person_id: string; local_user_profile_id: string }>(
    "select basecamp_person_id, local_user_profile_id from import_map_people",
  );
  const m = new Map<number, string>();
  for (const row of r.rows) m.set(Number(row.basecamp_person_id), row.local_user_profile_id);
  return m;
}

async function loadKnownClients(q: Query): Promise<KnownClient[]> {
  const r = await q<{ id: string; code: string; name: string }>(
    "select id, code, name from clients order by code",
  );
  return r.rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
}

async function main(): Promise<void> {
  const flags = parseFlags();
  console.log(
    `[migrate-from-dump] dumpDir=${flags.dumpDir} phase=${flags.phase} ` +
    `projects=${flags.projects} dryRun=${flags.dryRun}`,
  );

  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    // Long batch import: keep pool small + recycle clients so transient
    // connection drops on the pooler don't accumulate.
    max: 4,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  });
  // Without this, an error on an IDLE pg client emits an unhandled 'error'
  // event on the pool and crashes the process (EADDRNOTAVAIL, ECONNRESET, ...).
  // Active queries still reject normally and are caught by per-record try/catch.
  pool.on("error", (err) => {
    console.warn(`[migrate-from-dump] pool client error (non-fatal): ${err.message}`);
  });

  async function runQuery<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
    const transient = ["EADDRNOTAVAIL", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "ECONNREFUSED"];
    let attempt = 0;
    while (true) {
      try {
        const r = await pool.query(text, values);
        return { rows: r.rows as T[] };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt < 3 && code && transient.includes(code)) {
          const wait = 500 * 2 ** attempt;
          attempt++;
          console.warn(`[migrate-from-dump] transient pg error ${code}; retry ${attempt}/3 in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
  }
  const realQ: Query = ((text: string, values?: unknown[]) =>
    runQuery(text, values)) as Query;
  const writableQ: Query = flags.dryRun
    ? (async (sql: string, values?: unknown[]) => {
        if (sql.trim().toLowerCase().startsWith("select")) return realQ(sql, values);
        return { rows: [] };
      }) as Query
    : realQ;

  const accountId = process.env.BASECAMP_ACCOUNT_ID ?? requireEnv("BC2_ACCOUNT_ID");
  const username = requireEnv("BASECAMP_USERNAME");
  const password = requireEnv("BASECAMP_PASSWORD");
  const userAgent = process.env.BASECAMP_USER_AGENT ?? requireEnv("BC2_USER_AGENT");
  const client = new Bc2Client({ accountId, username, password, userAgent });

  const errors = await loadErrorsSet(flags.dumpDir);
  const reader = createDumpReader({ dumpDir: flags.dumpDir, client, errors });

  // Skip job-row insert under --dry-run; writableQ would no-op the insert and
  // we'd lose the returned id. Use a synthetic id so phase modules can still
  // attach logs (which also no-op under dry-run).
  const jobId = flags.dryRun
    ? `dryrun-${Date.now()}`
    : await createImportJob(writableQ, {
        source: "dump",
        dumpDir: flags.dumpDir,
        flags,
      });
  console.log(`[migrate-from-dump] job=${jobId}`);

  // KnownClients are needed by migrateProjects' resolveTitle. Loaded via
  // realQ even in dry-run because it's a SELECT. Skip when --no-known-clients.
  const knownClients: KnownClient[] = flags.noKnownClients
    ? []
    : await loadKnownClients(realQ);
  console.log(`  knownClients: ${knownClients.length}`);

  let totalSuccess = 0;
  let totalFailed = 0;

  try {
    if (flags.phase === "all" || flags.phase === "people") {
      const r = await migratePeople({ reader, q: writableQ, jobId });
      totalSuccess += r.success;
      totalFailed += r.failed;
      console.log(`  people: success=${r.success} failed=${r.failed}`);
    }

    let migratedProjects: MigratedProject[] = [];
    const needsProjects =
      flags.phase === "all" ||
      flags.phase === "projects" ||
      flags.phase === "threads" ||
      flags.phase === "files";
    if (needsProjects) {
      const r = await migrateProjects({
        reader,
        q: writableQ,
        jobId,
        filter: flags.projects,
        limit: flags.limit,
        onlyProjectId: flags.projectId,
        knownClients,
      });
      migratedProjects = r.migrated;
      totalSuccess += migratedProjects.length;
      console.log(`  projects: ${migratedProjects.length}`);
    }

    if (flags.phase === "all" || flags.phase === "threads") {
      const personMap = await loadPersonMap(realQ);
      const totalProjects = migratedProjects.length;
      let pIdx = 0;
      for (const p of migratedProjects) {
        pIdx++;
        const r = await migrateThreadsAndComments({
          reader,
          q: writableQ,
          jobId,
          project: p,
          personMap,
        });
        totalSuccess += r.threads.success;
        totalFailed += r.threads.failed;
        console.log(
          `  threads ${p.bc2Id} ${pIdx} of ${totalProjects}: ok=${r.threads.success} fail=${r.threads.failed} skip=${r.threads.skipped}`,
        );
      }
    }

    if (!flags.noFiles && (flags.phase === "all" || flags.phase === "files")) {
      const personMap = await loadPersonMap(realQ);
      const downloadEnv = { username, password, userAgent };
      const totalProjects = migratedProjects.length;
      let pIdx = 0;
      for (const p of migratedProjects) {
        pIdx++;
        const r = await migrateFiles({
          reader,
          q: writableQ,
          jobId,
          project: p,
          downloadEnv,
          personMap,
        });
        totalSuccess += r.files.success;
        totalFailed += r.files.failed;
        console.log(
          `  files ${p.bc2Id} ${pIdx} of ${totalProjects}: ok=${r.files.success} fail=${r.files.failed}`,
        );
      }
    }

    if (!flags.dryRun) {
      await incrementCounters(writableQ, jobId, totalSuccess, totalFailed);
      await finishJob(writableQ, jobId, "completed");
    }
    console.log(
      `[migrate-from-dump] done. success=${totalSuccess} failed=${totalFailed}`,
    );
  } catch (err) {
    if (!flags.dryRun) await finishJob(writableQ, jobId, "failed");
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate-from-dump] fatal:", err);
  process.exit(1);
});
