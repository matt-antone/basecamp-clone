import { createHash } from "node:crypto";
import type { FileRow, DiscussionRow } from "./types";

export function toIsoMs(d: Date): string {
  // Truncate sub-millisecond precision.
  const ms = Math.floor(d.getTime());
  return new Date(ms).toISOString();
}

export function normalizeBody(body: string | null | undefined): string {
  if (body == null) return "";
  return body.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function fileFpA(f: Pick<FileRow, "filename" | "size" | "created_at">): string {
  return `${f.filename}|${f.size}|${toIsoMs(f.created_at)}`;
}

export function fileFpB(f: Pick<FileRow, "dropbox_path">): string | null {
  return f.dropbox_path ?? null;
}

export function discussionFp(
  d: Pick<DiscussionRow, "title" | "body" | "created_at">,
): string {
  return `${d.title}|${sha256(normalizeBody(d.body))}|${toIsoMs(d.created_at)}`;
}

export function commentFp(c: {
  body: string | null;
  author_test_user_id: number;
  created_at: Date;
}): string {
  return `${sha256(normalizeBody(c.body))}|${c.author_test_user_id}|${toIsoMs(c.created_at)}`;
}
