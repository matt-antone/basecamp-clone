// scripts/sync-prod-to-test.ts
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { runSync } from "../lib/imports/sync-prod-to-test/sync-orchestrator";
import { isoStamp } from "../lib/imports/sync-prod-to-test/csv-writer";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const cutoffStr = arg("cutoff", "2026-04-24T00:00:00Z")!;
  const dryRun = flag("dry-run");
  const skipFiles = flag("skip-files");
  const backupConfirmed = flag("backup-confirmed");

  if (!dryRun && !backupConfirmed) {
    console.error("Refusing to run without --backup-confirmed (or use --dry-run).");
    process.exit(2);
  }
  if (!process.env.PROD_DATABASE_URL) throw new Error("PROD_DATABASE_URL not set");
  if (!process.env.DATABASE_URL)      throw new Error("DATABASE_URL (test) not set");

  const prod = new Pool({
    connectionString: process.env.PROD_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const test = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  // Enforce prod read-only per connection.
  prod.on("connect", (c) => {
    c.query("SET default_transaction_read_only = on").catch(() => {
      /* best effort; further writes will fail */
    });
  });

  const stamp = isoStamp();
  const extractDir = join(process.cwd(), "docs/reconcile/extracts", stamp);
  mkdirSync(extractDir, { recursive: true });

  const outcomes = await runSync(
    { prod, test },
    {
      cutoff: new Date(cutoffStr),
      dryRun,
      skipFiles,
      runId: randomUUID(),
      extractDir,
    },
  );
  const totals = outcomes.reduce((a, o) => {
    a.threads += o.threads_inserted; a.comments += o.comments_inserted;
    a.files += o.files_inserted; a.failed += o.files_failed_dropbox;
    return a;
  }, { threads: 0, comments: 0, files: 0, failed: 0 });
  console.log(`done. projects=${outcomes.length} threads=${totals.threads} comments=${totals.comments} files=${totals.files} failed_copies=${totals.failed}`);
  console.log(`extract: ${extractDir}`);
  await prod.end();
  await test.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
