// tests/integration/migrate-from-dump.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { Pool } from "pg";
import { makeFixtureDump } from "../support/dump-fixture";

const DB = process.env.DATABASE_URL_TEST;

describe.skipIf(!DB)("migrate-from-dump (integration)", () => {
  let dumpDir: string;
  let pool: Pool;

  beforeAll(async () => {
    dumpDir = await makeFixtureDump();
    pool = new Pool({ connectionString: DB });
    await pool.query("delete from import_logs");
    await pool.query("delete from import_jobs");
    await pool.query("delete from import_map_comments");
    await pool.query("delete from import_map_threads");
    await pool.query("delete from import_map_projects");
    await pool.query("delete from import_map_people");
    await pool.query("delete from discussion_comments where source = 'bc2_import'");
    await pool.query("delete from discussion_threads where source = 'bc2_import'");
    await pool.query("delete from projects where source = 'bc2_import'");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs end-to-end against a fixture dump (no files)", () => {
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/migrate-from-dump.ts", `--dump-dir=${dumpDir}`, "--no-files"],
      { stdio: "inherit", env: { ...process.env, DATABASE_URL: DB } },
    );
    expect(result.status).toBe(0);
  });

  it("populated import_map_* and import_logs.data_source='dump'", async () => {
    const projects = await pool.query("select count(*)::int as c from import_map_projects");
    const threads = await pool.query("select count(*)::int as c from import_map_threads");
    const comments = await pool.query("select count(*)::int as c from import_map_comments");
    const sources = await pool.query(
      "select data_source, count(*)::int as c from import_logs group by data_source",
    );
    expect(projects.rows[0].c).toBe(1);
    expect(threads.rows[0].c).toBe(1);
    expect(comments.rows[0].c).toBe(1);
    expect(sources.rows.find((r: { data_source: string }) => r.data_source === "dump")?.c).toBeGreaterThan(0);
  });
});
