// lib/imports/reconcile/diff.ts
import { fileFpA, fileFpB, discussionFp, commentFp } from "./fingerprints";
import type { FileRow, DiscussionRow } from "./types";

export interface DiffResult<ProdItem> {
  toInsert: ProdItem[];
  duplicates: { prodId: number; testId: number; matchedBy: string }[];
}

export function diffFiles(
  prod: FileRow[],
  test: FileRow[],
): DiffResult<FileRow> {
  const aIndex = new Map<string, number>();
  const bIndex = new Map<string, number>();
  for (const t of test) {
    aIndex.set(fileFpA(t), t.id);
    const b = fileFpB(t);
    if (b !== null) bIndex.set(b, t.id);
  }
  const toInsert: FileRow[] = [];
  const duplicates: DiffResult<FileRow>["duplicates"] = [];
  for (const p of prod) {
    const a = fileFpA(p);
    const b = fileFpB(p);
    const aHit = aIndex.get(a);
    const bHit = b !== null ? bIndex.get(b) : undefined;
    if (aHit !== undefined) {
      duplicates.push({ prodId: p.id, testId: aHit, matchedBy: "fpA" });
    } else if (bHit !== undefined) {
      duplicates.push({ prodId: p.id, testId: bHit, matchedBy: "fpB" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}

export function diffDiscussions(
  prod: DiscussionRow[],
  test: DiscussionRow[],
): DiffResult<DiscussionRow> {
  const idx = new Map<string, number>();
  for (const t of test) idx.set(discussionFp(t), t.id);
  const toInsert: DiscussionRow[] = [];
  const duplicates: DiffResult<DiscussionRow>["duplicates"] = [];
  for (const p of prod) {
    const fp = discussionFp(p);
    const hit = idx.get(fp);
    if (hit !== undefined) {
      duplicates.push({ prodId: p.id, testId: hit, matchedBy: "discussionFp" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}

export interface CommentForDiff {
  id: number;
  body: string | null;
  author_test_user_id: number;
  created_at: Date;
}

export function diffComments(
  prod: CommentForDiff[],
  test: CommentForDiff[],
): DiffResult<CommentForDiff> {
  const idx = new Map<string, number>();
  for (const t of test) idx.set(commentFp(t), t.id);
  const toInsert: CommentForDiff[] = [];
  const duplicates: DiffResult<CommentForDiff>["duplicates"] = [];
  for (const p of prod) {
    const fp = commentFp(p);
    const hit = idx.get(fp);
    if (hit !== undefined) {
      duplicates.push({ prodId: p.id, testId: hit, matchedBy: "commentFp" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}
