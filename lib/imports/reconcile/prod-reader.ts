// lib/imports/reconcile/prod-reader.ts
import type { Pool } from "pg";
import type { ProdProject, FileRow, DiscussionRow, CommentRow } from "./types";

export interface ProdReader {
  activeProjects(opts: { projectBc2Id?: number; limit?: number | null }): Promise<ProdProject[]>;
  filesForProject(projectId: number): Promise<FileRow[]>;
  discussionsForProject(projectId: number): Promise<DiscussionRow[]>;
  commentsForThread(threadId: number): Promise<CommentRow[]>;
}

export function createProdReader(prodPool: Pool): ProdReader {
  async function activeProjects(opts: {
    projectBc2Id?: number;
    limit?: number | null;
  }): Promise<ProdProject[]> {
    const params: any[] = [];
    let where = "p.archived = false";
    if (opts.projectBc2Id !== undefined) {
      params.push(opts.projectBc2Id);
      where += ` AND m.bc2_id = $${params.length}`;
    }
    let sql = `
      SELECT p.id, m.bc2_id, p.title, p.client_id, c.code AS client_code,
             p.slug, p.description, p.archived, p.created_at, p.updated_at
        FROM projects p
        JOIN bc2_projects_map m ON m.project_id = p.id
        JOIN clients c ON c.id = p.client_id
       WHERE ${where}
       ORDER BY p.id`;
    if (opts.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const r = await prodPool.query(sql, params);
    return r.rows.map(rowToProdProject);
  }

  async function filesForProject(projectId: number): Promise<FileRow[]> {
    const r = await prodPool.query(
      `SELECT id, project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at
         FROM project_files
        WHERE project_id = $1
        ORDER BY id`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function discussionsForProject(projectId: number): Promise<DiscussionRow[]> {
    const r = await prodPool.query(
      `SELECT id, project_id, author_id, title, body, created_at
         FROM threads
        WHERE project_id = $1
        ORDER BY id`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function commentsForThread(threadId: number): Promise<CommentRow[]> {
    const r = await prodPool.query(
      `SELECT id, thread_id, author_id, body, created_at
         FROM comments
        WHERE thread_id = $1
        ORDER BY id`,
      [threadId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  return { activeProjects, filesForProject, discussionsForProject, commentsForThread };
}

function rowToProdProject(row: any): ProdProject {
  return {
    ...row,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
