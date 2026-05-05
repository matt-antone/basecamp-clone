// lib/imports/reconcile/test-writer.ts
import type { Pool, PoolClient } from "pg";
import type {
  ProdProject,
  FileRow,
  DiscussionRow,
  CommentRow,
} from "./types";

export interface TestWriter {
  withProjectTx<R>(fn: (client: PoolClient) => Promise<R>): Promise<R>;
  filesForProject(client: PoolClient, projectId: number): Promise<FileRow[]>;
  discussionsForProject(client: PoolClient, projectId: number): Promise<DiscussionRow[]>;
  commentsForThread(client: PoolClient, threadId: number): Promise<CommentRow[]>;
  createProject(client: PoolClient, prod: ProdProject, mappedClientId: number): Promise<number>;
  insertProjectMapRow(client: PoolClient, projectId: number, bc2Id: number): Promise<void>;
  insertFile(
    client: PoolClient,
    projectId: number,
    file: FileRow,
    uploaderTestUserId: number,
  ): Promise<number>;
  insertDiscussion(
    client: PoolClient,
    projectId: number,
    discussion: DiscussionRow,
    authorTestUserId: number,
  ): Promise<number>;
  insertComment(
    client: PoolClient,
    threadId: number,
    comment: CommentRow,
    authorTestUserId: number,
  ): Promise<number>;
}

export function createTestWriter(testPool: Pool): TestWriter {
  async function withProjectTx<R>(fn: (c: PoolClient) => Promise<R>): Promise<R> {
    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async function filesForProject(c: PoolClient, projectId: number): Promise<FileRow[]> {
    const r = await c.query(
      `SELECT id, project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at
         FROM project_files WHERE project_id = $1`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function discussionsForProject(c: PoolClient, projectId: number): Promise<DiscussionRow[]> {
    const r = await c.query(
      `SELECT id, project_id, author_id, title, body, created_at
         FROM threads WHERE project_id = $1`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function commentsForThread(c: PoolClient, threadId: number): Promise<CommentRow[]> {
    const r = await c.query(
      `SELECT id, thread_id, author_id, body, created_at
         FROM comments WHERE thread_id = $1`,
      [threadId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function createProject(
    c: PoolClient,
    prod: ProdProject,
    mappedClientId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO projects (title, client_id, slug, description, archived, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [prod.title, mappedClientId, prod.slug, prod.description, false, prod.created_at, prod.updated_at],
    );
    return r.rows[0].id;
  }

  async function insertProjectMapRow(c: PoolClient, projectId: number, bc2Id: number): Promise<void> {
    await c.query(
      `INSERT INTO bc2_projects_map (project_id, bc2_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, bc2Id],
    );
  }

  async function insertFile(
    c: PoolClient,
    projectId: number,
    f: FileRow,
    uploaderTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [projectId, uploaderTestUserId, f.filename, f.size, f.mime_type, f.dropbox_path, f.created_at],
    );
    return r.rows[0].id;
  }

  async function insertDiscussion(
    c: PoolClient,
    projectId: number,
    d: DiscussionRow,
    authorTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO threads (project_id, author_id, title, body, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [projectId, authorTestUserId, d.title, d.body, d.created_at],
    );
    return r.rows[0].id;
  }

  async function insertComment(
    c: PoolClient,
    threadId: number,
    cm: CommentRow,
    authorTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO comments (thread_id, author_id, body, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [threadId, authorTestUserId, cm.body, cm.created_at],
    );
    return r.rows[0].id;
  }

  return {
    withProjectTx,
    filesForProject,
    discussionsForProject,
    commentsForThread,
    createProject,
    insertProjectMapRow,
    insertFile,
    insertDiscussion,
    insertComment,
  };
}
