// tests/unit/reconcile/diff.test.ts
import { describe, it, expect } from "vitest";
import {
  diffFiles,
  diffDiscussions,
  diffComments,
} from "@/lib/imports/reconcile/diff";

const t = new Date("2026-04-01T00:00:00Z");

describe("diffFiles", () => {
  it("matches by fpA (filename+size+created_at)", () => {
    const prod = [{ id: 10, filename: "a.pdf", size: 1, dropbox_path: "/p/a", created_at: t }];
    const test = [{ id: 99, filename: "a.pdf", size: 1, dropbox_path: "/different", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ prodId: 10, testId: 99, matchedBy: "fpA" });
  });

  it("matches by fpB (dropbox_path) when fpA differs", () => {
    const prod = [{ id: 10, filename: "renamed.pdf", size: 2, dropbox_path: "/p/a", created_at: t }];
    const test = [{ id: 99, filename: "a.pdf", size: 1, dropbox_path: "/p/a", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0].matchedBy).toBe("fpB");
  });

  it("returns prod-only items when neither key matches", () => {
    const prod = [{ id: 10, filename: "x.pdf", size: 1, dropbox_path: "/p/x", created_at: t }];
    const test = [{ id: 99, filename: "y.pdf", size: 2, dropbox_path: "/p/y", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert.map((f) => f.id)).toEqual([10]);
    expect(r.duplicates).toEqual([]);
  });

  it("treats null dropbox_path as never matching by fpB", () => {
    const prod = [{ id: 10, filename: "x.pdf", size: 1, dropbox_path: null, created_at: t }];
    const test = [{ id: 99, filename: "x.pdf", size: 1, dropbox_path: null, created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0].matchedBy).toBe("fpA");
  });
});

describe("diffDiscussions", () => {
  it("matches identical title+body+ts", () => {
    const prod = [{ id: 1, title: "T", body: "x", created_at: t }];
    const test = [{ id: 99, title: "T", body: "x", created_at: t }];
    const r = diffDiscussions(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ prodId: 1, testId: 99 });
  });
  it("inserts when body differs", () => {
    const prod = [{ id: 1, title: "T", body: "x", created_at: t }];
    const test = [{ id: 99, title: "T", body: "y", created_at: t }];
    const r = diffDiscussions(prod as any, test as any);
    expect(r.toInsert.map((d) => d.id)).toEqual([1]);
  });
});

describe("diffComments", () => {
  it("dedupes by body+author_test_user_id+ts", () => {
    const prod = [{ id: 1, body: "yo", author_test_user_id: 5, created_at: t }];
    const test = [{ id: 99, body: "yo", author_test_user_id: 5, created_at: t }];
    const r = diffComments(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates).toHaveLength(1);
  });
  it("treats different mapped authors as different", () => {
    const prod = [{ id: 1, body: "yo", author_test_user_id: 5, created_at: t }];
    const test = [{ id: 99, body: "yo", author_test_user_id: 6, created_at: t }];
    const r = diffComments(prod as any, test as any);
    expect(r.toInsert.map((c) => c.id)).toEqual([1]);
  });
});
