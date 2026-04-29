// lib/imports/bc2-attachment-linkage.ts
// Resolve discussion_threads / discussion_comments IDs for BC2 attachments using import maps.

import type { QueryResultRow } from "pg";
import type { Bc2Attachment, Bc2Attachable } from "./bc2-fetcher";

export type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) => Promise<{ rows: T[] }>;

/**
 * Maps BC2 `attachable` (from attachments list/detail) to local `thread_id` / `comment_id`.
 * See https://github.com/basecamp/bcx-api/blob/master/sections/attachments.md
 */
export async function resolveBc2LinkageFromAttachable(
  query: QueryFn,
  attachable: Bc2Attachable | null | undefined
): Promise<{ threadId: string | null; commentId: string | null }> {
  if (!attachable) {
    return { threadId: null, commentId: null };
  }

  const t = attachable.type.trim();
  if (t === "Message") {
    const r = await query<{ local_thread_id: string }>(
      "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
      [String(attachable.id)]
    );
    const tid = r.rows[0]?.local_thread_id ?? null;
    return { threadId: tid, commentId: null };
  }

  if (t === "Comment") {
    const r = await query<{ thread_id: string; comment_id: string }>(
      `select c.thread_id, c.id as comment_id
       from import_map_comments m
       join discussion_comments c on c.id = m.local_comment_id
       where m.basecamp_comment_id = $1`,
      [String(attachable.id)]
    );
    const row = r.rows[0];
    if (row) {
      return { threadId: row.thread_id, commentId: row.comment_id };
    }
    return { threadId: null, commentId: null };
  }

  return { threadId: null, commentId: null };
}

export async function resolveBc2AttachmentLinkage(
  query: QueryFn,
  attachment: Bc2Attachment
): Promise<{ threadId: string | null; commentId: string | null }> {
  return resolveBc2LinkageFromAttachable(query, attachment.attachable);
}
