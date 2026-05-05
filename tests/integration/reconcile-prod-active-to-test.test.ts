// tests/integration/reconcile-prod-active-to-test.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROD_SCHEMA = "reconcile_prod";
const TEST_SCHEMA = "reconcile_test";
const URL = process.env.TEST_DATABASE_URL;

if (!URL) {
  describe.skip("reconcile (no TEST_DATABASE_URL)", () => it.skip("skipped", () => {}));
} else {
  const pool = new Pool({ connectionString: URL });

  function envFor(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PROD_DATABASE_URL: `${URL}?options=-csearch_path=${PROD_SCHEMA}`,
      DATABASE_URL: `${URL}?options=-csearch_path=${TEST_SCHEMA}`,
      RECONCILE_CONFIRM: "yes",
    };
  }

  function runReconcile(args: string[]): void {
    execFileSync("pnpm", ["tsx", "scripts/reconcile-prod-active-to-test.ts", ...args], {
      env: envFor(),
      stdio: "pipe",
    });
  }

  beforeAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${PROD_SCHEMA} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${PROD_SCHEMA}`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    for (const schema of [PROD_SCHEMA, TEST_SCHEMA]) {
      await pool.query(`SET search_path TO ${schema}`);
      await pool.query(`
        CREATE TABLE clients (id serial PRIMARY KEY, code text UNIQUE NOT NULL);
        CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
        CREATE TABLE projects (
          id serial PRIMARY KEY, title text, client_id int, slug text,
          description text, archived boolean DEFAULT false,
          created_at timestamptz, updated_at timestamptz
        );
        CREATE TABLE project_files (
          id serial PRIMARY KEY, project_id int, uploader_id int,
          filename text, size bigint, mime_type text, dropbox_path text,
          created_at timestamptz
        );
        CREATE TABLE threads (
          id serial PRIMARY KEY, project_id int, author_id int,
          title text, body text, created_at timestamptz
        );
        CREATE TABLE comments (
          id serial PRIMARY KEY, thread_id int, author_id int,
          body text, created_at timestamptz
        );
        CREATE TABLE bc2_projects_map (project_id int PRIMARY KEY, bc2_id bigint UNIQUE);
        CREATE TABLE bc2_people_map (user_id int PRIMARY KEY, bc2_id bigint UNIQUE);
      `);
    }

    await pool.query(`SET search_path TO ${TEST_SCHEMA}`);
    await pool.query(readFileSync(join(process.cwd(), "supabase/migrations/0030_reconcile_logs.sql"), "utf8"));

    for (const schema of [PROD_SCHEMA, TEST_SCHEMA]) {
      await pool.query(`INSERT INTO ${schema}.clients (code) VALUES ('ACME')`);
      await pool.query(`INSERT INTO ${schema}.users (email) VALUES ('u@x.test')`);
      await pool.query(`INSERT INTO ${schema}.bc2_people_map (user_id, bc2_id) VALUES (1, 5000)`);
    }

    const pCreated = "2026-01-01T00:00:00Z";
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.projects (id, title, client_id, slug, description, archived, created_at, updated_at)
                      VALUES (1, 'Acme Site', 1, 'acme-site', 'desc', false, $1, $1)`, [pCreated]);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.bc2_projects_map (project_id, bc2_id) VALUES (1, 9001)`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
                      VALUES (1, 1, 'orphan.pdf', 10, 'application/pdf', '/orphan', '2025-12-01T00:00:00Z'),
                             (1, 1, 'kept.pdf', 20, 'application/pdf', '/kept', '2026-01-15T00:00:00Z'),
                             (1, 1, 'shared.pdf', 30, 'application/pdf', '/shared', '2026-02-01T00:00:00Z')`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.threads (id, project_id, author_id, title, body, created_at)
                      VALUES (1, 1, 1, 'Hello', 'world', '2026-02-01T00:00:00Z'),
                             (2, 1, 1, 'Shared', 'same', '2026-02-15T00:00:00Z')`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.comments (thread_id, author_id, body, created_at)
                      VALUES (2, 1, 'cmt', '2026-02-15T01:00:00Z')`);

    await pool.query(`INSERT INTO ${TEST_SCHEMA}.projects (id, title, client_id, slug, description, archived, created_at, updated_at)
                      VALUES (1, 'Acme Site', 1, 'acme-site', 'desc', false, $1, $1)`, [pCreated]);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.bc2_projects_map (project_id, bc2_id) VALUES (1, 9001)`);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
                      VALUES (1, 1, 'shared.pdf', 30, 'application/pdf', '/shared', '2026-02-01T00:00:00Z')`);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.threads (id, project_id, author_id, title, body, created_at)
                      VALUES (1, 1, 1, 'Shared', 'same', '2026-02-15T00:00:00Z')`);
  }, 60000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${PROD_SCHEMA} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it("syncs prod-only content, drops orphans, and is idempotent", async () => {
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--out-dir=${out}`]);

    const tFiles = await pool.query(`SELECT filename FROM ${TEST_SCHEMA}.project_files ORDER BY filename`);
    expect(tFiles.rows.map((r) => r.filename)).toEqual(["kept.pdf", "shared.pdf"]);

    const tThreads = await pool.query(`SELECT title FROM ${TEST_SCHEMA}.threads ORDER BY title`);
    expect(tThreads.rows.map((r) => r.title)).toEqual(["Hello", "Shared"]);
    const tComments = await pool.query(`SELECT body FROM ${TEST_SCHEMA}.comments`);
    expect(tComments.rows.map((r) => r.body)).toEqual(["cmt"]);

    const before = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.project_files) AS f,
                                            (SELECT count(*) FROM ${TEST_SCHEMA}.threads) AS t,
                                            (SELECT count(*) FROM ${TEST_SCHEMA}.comments) AS c`);
    runReconcile([`--out-dir=${out}`]);
    const after = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.project_files) AS f,
                                           (SELECT count(*) FROM ${TEST_SCHEMA}.threads) AS t,
                                           (SELECT count(*) FROM ${TEST_SCHEMA}.comments) AS c`);
    expect(after.rows[0]).toEqual(before.rows[0]);

    rmSync(out, { recursive: true, force: true });
  }, 120000);
}
