import { describe, it, expect } from "vitest";
import {
  fileFpA,
  fileFpB,
  discussionFp,
  commentFp,
  normalizeBody,
  toIsoMs,
} from "@/lib/imports/reconcile/fingerprints";

describe("fingerprints", () => {
  const t = new Date("2026-05-01T12:34:56.789Z");

  describe("toIsoMs", () => {
    it("returns ms-precision iso string", () => {
      expect(toIsoMs(t)).toBe("2026-05-01T12:34:56.789Z");
    });
  });

  describe("normalizeBody", () => {
    it("converts CRLF to LF", () => {
      expect(normalizeBody("a\r\nb")).toBe("a\nb");
    });
    it("trims trailing whitespace", () => {
      expect(normalizeBody("hello   \n  ")).toBe("hello");
    });
    it("treats null as empty", () => {
      expect(normalizeBody(null)).toBe("");
    });
  });

  describe("fileFpA", () => {
    it("combines filename, size, created_at", () => {
      expect(fileFpA({ filename: "x.pdf", size: 1024, created_at: t } as any))
        .toBe("x.pdf|1024|2026-05-01T12:34:56.789Z");
    });
  });

  describe("fileFpB", () => {
    it("returns dropbox_path", () => {
      expect(fileFpB({ dropbox_path: "/a/b" } as any)).toBe("/a/b");
    });
    it("returns null when path missing", () => {
      expect(fileFpB({ dropbox_path: null } as any)).toBeNull();
    });
  });

  describe("discussionFp", () => {
    it("normalizes body before hashing", () => {
      const a = discussionFp({ title: "T", body: "hi\r\n", created_at: t } as any);
      const b = discussionFp({ title: "T", body: "hi", created_at: t } as any);
      expect(a).toBe(b);
    });
    it("differs when title differs", () => {
      const a = discussionFp({ title: "T", body: "x", created_at: t } as any);
      const b = discussionFp({ title: "U", body: "x", created_at: t } as any);
      expect(a).not.toBe(b);
    });
  });

  describe("commentFp", () => {
    it("includes mapped author id", () => {
      const a = commentFp({ body: "hi", author_test_user_id: 7, created_at: t } as any);
      const b = commentFp({ body: "hi", author_test_user_id: 8, created_at: t } as any);
      expect(a).not.toBe(b);
    });
    it("normalizes body", () => {
      const a = commentFp({ body: "x\r\n", author_test_user_id: 1, created_at: t } as any);
      const b = commentFp({ body: "x", author_test_user_id: 1, created_at: t } as any);
      expect(a).toBe(b);
    });
  });
});
