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
import type { ProdProject } from "@/lib/imports/reconcile/types";
import type { ProdReader } from "@/lib/imports/reconcile/prod-reader";
import type { TestWriter } from "@/lib/imports/reconcile/test-writer";
import type { Mappers } from "@/lib/imports/reconcile/mappers";
import type { JobLogger } from "@/lib/imports/reconcile/reconcile-job";
import type { CsvWriter } from "@/lib/imports/reconcile/csv-writer";
import { fileFpA, discussionFp, commentFp } from "@/lib/imports/reconcile/fingerprints";

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
  prodPool.on("connect", (client) => {
    client.query("SET default_transaction_read_only = on");
  });
  const testPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await ensureBackupGate(testPool, flags.dryRun);

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

async function processProject(args: {
  proj: ProdProject;
  prodReader: ProdReader;
  testWriter: TestWriter;
  mappers: Mappers;
  job: JobLogger;
  csv: CsvWriter;
  summary: ReconcileSummary;
  dryRun: boolean;
}) {
  const { proj, prodReader, testWriter, mappers, job, csv, summary, dryRun } = args;

  if (proj.bc2_id == null) {
    summary.unmappedProjects++;
    await csv.row("unmapped-active.csv", [proj.id, proj.title, proj.client_code, proj.created_at.toISOString()]);
    await job.log({ projectBc2Id: null, phase: "project", action: "skipped", reason: "no_bc2_id" });
    return;
  }

  let testProjectId = await mappers.bc2IdToTestProjectId(proj.bc2_id);
  if (testProjectId == null) {
    const mappedClientId = await mappers.testClientIdByCode(proj.client_code);
    if (mappedClientId == null) {
      summary.unresolvedClient++;
      await csv.row("unresolved-client.csv", [proj.id, proj.title, proj.client_code]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "skipped", reason: "unresolved_client_code" });
      return;
    }
    if (dryRun) {
      summary.newTestProjects++;
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "inserted", prodId: proj.id, reason: "dry_run" });
    } else {
      await testWriter.withProjectTx(async (c) => {
        const newId = await testWriter.createProject(c, proj, mappedClientId);
        await testWriter.insertProjectMapRow(c, newId, proj.bc2_id);
        testProjectId = newId;
      });
      summary.newTestProjects++;
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "inserted", prodId: proj.id, testId: testProjectId });
    }
  }

  if (testProjectId == null) return;

  const prodFiles = await prodReader.filesForProject(proj.id);
  const prodDiscussions = await prodReader.discussionsForProject(proj.id);

  const f = applyOrphanFilter(prodFiles, proj);
  const d = applyOrphanFilter(prodDiscussions, proj);
  await recordOrphans(csv, job, proj, "file", f.dropped);
  await recordOrphans(csv, job, proj, "discussion", d.dropped);
  summary.files.orphan += f.dropped.length;
  summary.discussions.orphan += d.dropped.length;

  await testWriter.withProjectTx(async (c) => {
    // Files.
    const testFiles = await testWriter.filesForProject(c, testProjectId!);
    const fileDiff = diffFiles(f.kept, testFiles);
    for (const dup of fileDiff.duplicates) {
      summary.files.duplicate++;
      await csv.row("skipped-duplicate.csv", [proj.bc2_id, "file", dup.prodId, dup.testId, dup.matchedBy]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
    }
    for (const pf of fileDiff.toInsert) {
      const uploaderTestId = await mappers.prodUserIdToTestUserId(pf.uploader_id);
      if (uploaderTestId == null) {
        summary.peopleSkips++;
        await csv.row("unmapped-people.csv", [pf.uploader_id, "file", pf.id]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "skipped", prodId: pf.id, reason: "unmapped_author" });
        continue;
      }
      let newId = -1;
      if (!dryRun) newId = await testWriter.insertFile(c, testProjectId!, pf, uploaderTestId);
      summary.files.inserted++;
      await csv.row("inserted.csv", [proj.bc2_id, "file", pf.id, newId, fileFpA(pf)]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "inserted", prodId: pf.id, testId: newId });
    }

    // Discussions.
    const testDiscussions = await testWriter.discussionsForProject(c, testProjectId!);
    const discDiff = diffDiscussions(d.kept, testDiscussions);
    const prodIdToTestThreadId = new Map<number, number>();
    for (const dup of discDiff.duplicates) {
      summary.discussions.duplicate++;
      prodIdToTestThreadId.set(dup.prodId, dup.testId);
      await csv.row("skipped-duplicate.csv", [proj.bc2_id, "discussion", dup.prodId, dup.testId, dup.matchedBy]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
    }
    for (const pd of discDiff.toInsert) {
      const authorTestId = await mappers.prodUserIdToTestUserId(pd.author_id);
      if (authorTestId == null) {
        summary.peopleSkips++;
        await csv.row("unmapped-people.csv", [pd.author_id, "discussion", pd.id]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "skipped", prodId: pd.id, reason: "unmapped_author" });
        continue;
      }
      let newId = -1;
      if (!dryRun) newId = await testWriter.insertDiscussion(c, testProjectId!, pd, authorTestId);
      summary.discussions.inserted++;
      prodIdToTestThreadId.set(pd.id, newId);
      await csv.row("inserted.csv", [proj.bc2_id, "discussion", pd.id, newId, discussionFp(pd)]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "inserted", prodId: pd.id, testId: newId });
    }

    // Comments.
    for (const [prodDiscId, testThreadId] of prodIdToTestThreadId) {
      const prodComments = await prodReader.commentsForThread(prodDiscId);
      const c2 = applyOrphanFilter(prodComments, proj);
      summary.comments.orphan += c2.dropped.length;
      await recordOrphans(csv, job, proj, "comment", c2.dropped);

      const prodMapped = await Promise.all(
        c2.kept.map(async (cm) => ({
          ...cm,
          author_test_user_id: await mappers.prodUserIdToTestUserId(cm.author_id),
        })),
      );
      const prodForDiff = prodMapped
        .filter((cm) => cm.author_test_user_id !== null)
        .map((cm) => ({
          id: cm.id,
          body: cm.body,
          author_test_user_id: cm.author_test_user_id as number,
          created_at: cm.created_at,
        }));

      for (const cm of prodMapped) {
        if (cm.author_test_user_id == null) {
          summary.peopleSkips++;
          await csv.row("unmapped-people.csv", [cm.author_id, "comment", cm.id]);
          await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "skipped", prodId: cm.id, reason: "unmapped_author" });
        }
      }

      const testComments = (testThreadId > 0
        ? await testWriter.commentsForThread(c, testThreadId)
        : []).map((cm) => ({
          id: cm.id,
          body: cm.body,
          author_test_user_id: cm.author_id,
          created_at: cm.created_at,
        }));

      const cmDiff = diffComments(prodForDiff, testComments);
      for (const dup of cmDiff.duplicates) {
        summary.comments.duplicate++;
        await csv.row("skipped-duplicate.csv", [proj.bc2_id, "comment", dup.prodId, dup.testId, dup.matchedBy]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
      }
      for (const pc of cmDiff.toInsert) {
        const original = c2.kept.find((x) => x.id === pc.id)!;
        let newId = -1;
        if (!dryRun && testThreadId > 0) {
          newId = await testWriter.insertComment(c, testThreadId, original, pc.author_test_user_id);
        }
        summary.comments.inserted++;
        await csv.row("inserted.csv", [proj.bc2_id, "comment", pc.id, newId, commentFp(pc)]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "inserted", prodId: pc.id, testId: newId });
      }
    }
  });

  summary.syncedProjects++;
}

async function recordOrphans(
  csv: CsvWriter,
  job: JobLogger,
  proj: ProdProject,
  itemType: "file" | "discussion" | "comment",
  dropped: { id: number; created_at: Date }[],
) {
  for (const item of dropped) {
    const deltaSec = Math.floor((proj.created_at.getTime() - item.created_at.getTime()) / 1000);
    await csv.row("orphans-dropped.csv", [
      proj.bc2_id, proj.title, itemType, item.id,
      item.created_at.toISOString(), proj.created_at.toISOString(), deltaSec,
    ]);
    await job.log({ projectBc2Id: proj.bc2_id, phase: itemType, action: "orphan", prodId: item.id });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
