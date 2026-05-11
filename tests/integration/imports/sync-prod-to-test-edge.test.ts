import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { runSync } from "../../../lib/imports/sync-prod-to-test/sync-orchestrator";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROD = process.env.SYNC_TEST_PROD_DATABASE_URL;
const TEST = process.env.SYNC_TEST_DATABASE_URL;
const enabled = !!PROD && !!TEST;

(enabled ? describe : describe.skip)("sync edge cases (integration)", () => {
  it("dry-run rolls back all DB writes (no new rows in test after run)", async () => {
    const prod = new Pool({ connectionString: PROD, ssl: { rejectUnauthorized: false } });
    const test = new Pool({ connectionString: TEST, ssl: { rejectUnauthorized: false } });
    try {
      const before = (await test.query("SELECT count(*)::int AS n FROM projects")).rows[0].n;
      const dir = mkdtempSync(join(tmpdir(), "sync-edge-"));
      await runSync({ prod, test }, {
        cutoff: new Date("2026-04-24T00:00:00Z"),
        dryRun: true, skipFiles: true,
        runId: "edge-1", extractDir: dir,
      });
      const after = (await test.query("SELECT count(*)::int AS n FROM projects")).rows[0].n;
      expect(after).toBe(before);
    } finally {
      await prod.end();
      await test.end();
    }
  }, 60_000);

  it("prod pool refuses writes with default_transaction_read_only=on", async () => {
    const prod = new Pool({ connectionString: PROD, ssl: { rejectUnauthorized: false } });
    prod.on("connect", (c) => {
      c.query("SET default_transaction_read_only = on").catch(() => {});
    });
    try {
      await expect(
        prod.query("CREATE TEMP TABLE sync_block_check (x int)"),
      ).rejects.toThrow();
    } finally {
      await prod.end();
    }
  });
});
