// scripts/reconcile-prod-active-to-test.ts
import "dotenv/config";
import { Pool } from "pg";
import { join } from "node:path";
import { createProdReader } from "@/lib/imports/reconcile/prod-reader";
import { createTestWriter } from "@/lib/imports/reconcile/test-writer";
import { createMappers } from "@/lib/imports/reconcile/mappers";
import { applyOrphanFilter } from "@/lib/imports/reconcile/orphan-filter";
import { diffFiles, diffDiscussions, diffComments } from "@/lib/imports/reconcile/diff";
import { startJob } from "@/lib/imports/reconcile/reconcile-job";
import { createCsvWriter } from "@/lib/imports/reconcile/csv-writer";
import type { CliFlags, ReconcileSummary } from "@/lib/imports/reconcile/types";

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    projectId: null,
    limit: null,
    dryRun: false,
    outDir: `tmp/reconcile/${new Date().toISOString().replace(/[:.]/g, "-")}`,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--project-id=")) flags.projectId = Number(arg.slice("--project-id=".length));
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--out-dir=")) flags.outDir = arg.slice("--out-dir=".length);
    else throw new Error(`unknown flag: ${arg}`);
  }
  return flags;
}

async function ensureBackupGate(testPool: Pool, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  if (process.env.RECONCILE_CONFIRM !== "yes") {
    const r = await testPool.query("SELECT current_database() AS db, pg_database_size(current_database()) AS bytes");
    const { db, bytes } = r.rows[0];
    console.error(`Refusing to write to ${db} (${Number(bytes).toLocaleString()} bytes). Set RECONCILE_CONFIRM=yes after confirming a verified test-DB backup.`);
    process.exit(2);
  }
}

async function main() {
  const flags = parseFlags(process.argv);
  if (!process.env.PROD_DATABASE_URL) throw new Error("PROD_DATABASE_URL is required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const prodPool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
  const testPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await ensureBackupGate(testPool, flags.dryRun);

  await prodPool.query("SET default_transaction_read_only = on");

  const prodReader = createProdReader(prodPool);
  const testWriter = createTestWriter(testPool);
  const mappers = createMappers({ prodPool, testPool });
  const job = await startJob(testPool, { dryRun: flags.dryRun });

  const csv = await createCsvWriter(flags.outDir);
  await csv.open("unmapped-active.csv", ["prod_project_id", "title", "client_code", "prod_created_at"]);
  await csv.open("unresolved-client.csv", ["prod_project_id", "title", "prod_client_code"]);
  await csv.open("unmapped-people.csv", ["prod_user_id", "encountered_in", "prod_item_id"]);
  await csv.open("orphans-dropped.csv", ["project_bc2_id", "project_title", "item_type", "item_id", "item_created_at", "project_created_at", "delta_seconds"]);
  await csv.open("inserted.csv", ["project_bc2_id", "item_type", "prod_id", "test_id", "fingerprint"]);
  await csv.open("skipped-duplicate.csv", ["project_bc2_id", "item_type", "prod_id", "matched_test_id", "matched_by"]);

  const t0 = Date.now();
  const summary: ReconcileSummary = {
    startedAt: new Date(t0).toISOString(),
    finishedAt: null,
    dryRun: flags.dryRun,
    prodActiveTotal: 0,
    unmappedProjects: 0,
    unresolvedClient: 0,
    syncedProjects: 0,
    newTestProjects: 0,
    files:       { inserted: 0, duplicate: 0, orphan: 0 },
    discussions: { inserted: 0, duplicate: 0, orphan: 0 },
    comments:    { inserted: 0, duplicate: 0, orphan: 0 },
    peopleSkips: 0,
    walltimeMs: 0,
  };

  let exitCode = 0;
  let interrupted = false;
  process.on("SIGINT", () => { interrupted = true; });

  try {
    const projects = await prodReader.activeProjects({
      projectBc2Id: flags.projectId ?? undefined,
      limit: flags.limit,
    });
    summary.prodActiveTotal = projects.length;
    console.log(`Prod active projects to consider: ${projects.length}`);

    for (const proj of projects) {
      if (interrupted) break;
      try {
        await processProject({
          proj, prodReader, testWriter, mappers, job, csv, summary, dryRun: flags.dryRun,
        });
      } catch (e) {
        exitCode = 1;
        console.error(`Project ${proj.bc2_id} (${proj.title}) failed:`, e);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "error", reason: (e as Error).message });
      }
    }
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.walltimeMs = Date.now() - t0;
    await job.finish(interrupted ? "interrupted" : exitCode === 0 ? "completed" : "failed", summary);
    await csv.close();
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(flags.outDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    await prodPool.end();
    await testPool.end();
    if (interrupted) process.exit(130);
    process.exit(exitCode);
  }
}

// processProject defined in next task

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
