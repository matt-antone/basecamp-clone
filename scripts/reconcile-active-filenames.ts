#!/usr/bin/env npx tsx
// scripts/reconcile-active-filenames.ts
// One-time backfill: strip BC2 double-prefix from Dropbox filenames in active projects.
//
// Usage:
//   pnpm tsx scripts/reconcile-active-filenames.ts plan --out tmp/reconcile.plan.json [--limit N]
//   pnpm tsx scripts/reconcile-active-filenames.ts apply --plan tmp/reconcile.plan.json [--concurrency 4] [--limit N]

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname as pathDirname } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { DropboxStorageAdapter } from "../lib/storage/dropbox-adapter";
import { buildPlan, type PlanDbRow } from "../lib/reconcile-filenames/plan";
import { applyPlan } from "../lib/reconcile-filenames/apply";
import type { PlanRow, ProgressFile } from "../lib/reconcile-filenames/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

function parseFlags() {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    if (entry) return entry.split("=")[1];
    const idx = args.findIndex((a) => a === `--${flag}`);
    if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
    return null;
  };
  return {
    subcommand,
    out: get("out"),
    plan: get("plan"),
    limit: get("limit") ? parseInt(get("limit") as string, 10) : undefined,
    concurrency: get("concurrency") ? parseInt(get("concurrency") as string, 10) : 4
  };
}

async function listActiveFileRows(): Promise<PlanDbRow[]> {
  const { rows } = await query<{
    id: string;
    project_id: string;
    dropbox_file_id: string | null;
    dropbox_path: string | null;
  }>(
    `select pf.id, pf.project_id, pf.dropbox_file_id, pf.dropbox_path
       from project_files pf
       join projects p on p.id = pf.project_id
      where p.archived = false
        and pf.dropbox_path is not null`
  );
  // storage_dir is unused by buildPlan (we derive directory from dropbox_path).
  return rows.map((r) => ({ ...r, storage_dir: "" }));
}

async function ensureDir(filePath: string) {
  await mkdir(pathDirname(filePath), { recursive: true });
}

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

function siblingPath(planPath: string, suffix: string) {
  return `${planPath.replace(/\.json$/, "")}.${suffix}`;
}

function assertValidPlan(rows: unknown): asserts rows is PlanRow[] {
  if (!Array.isArray(rows)) {
    throw new Error("Malformed plan: expected an array");
  }
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] as Partial<PlanRow> | undefined;
    if (!r || typeof r.fileId !== "string" || typeof r.toPath !== "string" || typeof r.fromPath !== "string" || typeof r.projectId !== "string") {
      throw new Error(`Malformed plan: row ${i} is missing required fields (fileId, projectId, fromPath, toPath)`);
    }
    if (r.dropboxFileId !== null && typeof r.dropboxFileId !== "string") {
      throw new Error(`Malformed plan: row ${i} dropboxFileId must be string or null`);
    }
  }
}

async function runPlan(opts: { out: string; limit?: number }) {
  const adapter = new DropboxStorageAdapter();
  const result = await buildPlan({
    db: { listActiveFileRows },
    dropbox: { listFolderEntries: (p) => adapter.listFolderEntries(p) },
    limit: opts.limit
  });

  await ensureDir(opts.out);
  await writeFile(opts.out, JSON.stringify(result.plan, null, 2));
  await writeFile(siblingPath(opts.out, "orphans.json"), JSON.stringify(result.orphans, null, 2));
  await writeFile(siblingPath(opts.out, "errors.json"), JSON.stringify(result.errors, null, 2));

  console.log(
    JSON.stringify({
      level: "info",
      msg: "plan complete",
      planRows: result.plan.length,
      orphans: result.orphans.length,
      errors: result.errors.length,
      planFile: opts.out
    })
  );
}

async function runApply(opts: { plan: string; concurrency: number; limit?: number }) {
  const adapter = new DropboxStorageAdapter();
  const planRows = await readJsonOr<PlanRow[]>(opts.plan, []);
  assertValidPlan(planRows);
  const progressPath = siblingPath(opts.plan, "progress.json");
  const progress = await readJsonOr<ProgressFile>(progressPath, {});

  const flush = async () => {
    await writeFile(progressPath, JSON.stringify(progress, null, 2));
  };

  const result = await applyPlan({
    plan: planRows,
    progress,
    concurrency: opts.concurrency,
    limit: opts.limit,
    flush,
    onFlushError: (err) => {
      console.error(JSON.stringify({
        level: "error",
        msg: "progress flush failed",
        error: err instanceof Error ? err.message : String(err)
      }));
    },
    db: {
      updateDropboxPath: async ({ fileId, newPath }) => {
        await query(`update project_files set dropbox_path = $1 where id = $2`, [newPath, fileId]);
      }
    },
    dropbox: {
      moveFile: (args) => adapter.moveFile(args),
      listFolderEntries: (p) => adapter.listFolderEntries(p)
    }
  });

  await flush();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "apply complete",
      success: result.success,
      skipped: result.skipped,
      error: result.error,
      flushErrors: result.flushErrors,
      progressFile: progressPath
    })
  );
}

async function main() {
  const flags = parseFlags();
  try {
    if (flags.subcommand === "plan") {
      if (!flags.out) throw new Error("--out is required for plan");
      await runPlan({ out: flags.out, limit: flags.limit });
    } else if (flags.subcommand === "apply") {
      if (!flags.plan) throw new Error("--plan is required for apply");
      await runApply({ plan: flags.plan, concurrency: flags.concurrency, limit: flags.limit });
    } else {
      console.error("Usage: reconcile-active-filenames.ts plan|apply [flags]");
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
