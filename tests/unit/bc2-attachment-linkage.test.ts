import { describe, expect, it, vi } from "vitest";
import {
  resolveBc2AttachmentLinkage,
  resolveBc2LinkageFromAttachable
} from "@/lib/imports/bc2-attachment-linkage";
import type { Bc2Attachment } from "@/lib/imports/bc2-fetcher";

describe("resolveBc2LinkageFromAttachable", () => {
  it("returns nulls when attachable is missing", async () => {
    const query = vi.fn();
    const r = await resolveBc2LinkageFromAttachable(query as never, undefined);
    expect(r).toEqual({ threadId: null, commentId: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("maps Message attachable to import_map_threads", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ local_thread_id: "thread-uuid-1" }]
    });
    const r = await resolveBc2LinkageFromAttachable(query as never, {
      id: 55,
      type: "Message"
    });
    expect(r).toEqual({ threadId: "thread-uuid-1", commentId: null });
    expect(query).toHaveBeenCalledWith(
      "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
      ["55"]
    );
  });

  it("returns null thread for Message attachable when map is missing", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const r = await resolveBc2LinkageFromAttachable(query as never, {
      id: 56,
      type: "Message"
    });
    expect(r).toEqual({ threadId: null, commentId: null });
  });

  it("maps Comment attachable via import_map_comments + discussion_comments", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ thread_id: "t-1", comment_id: "c-1" }]
    });
    const r = await resolveBc2LinkageFromAttachable(query as never, {
      id: 99,
      type: "Comment"
    });
    expect(r).toEqual({ threadId: "t-1", commentId: "c-1" });
  });

  it("returns nulls for unsupported attachable types", async () => {
    const query = vi.fn();
    const r = await resolveBc2LinkageFromAttachable(query as never, {
      id: 123,
      type: "Upload"
    });
    expect(r).toEqual({ threadId: null, commentId: null });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("resolveBc2AttachmentLinkage", () => {
  it("delegates to attachable on attachment", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ local_thread_id: "thr" }]
    });
    const att: Bc2Attachment = {
      id: 1,
      name: "x.png",
      content_type: "image/png",
      byte_size: 1,
      url: "https://x",
      created_at: "",
      creator: { id: 1, name: "A" },
      attachable: { id: 10, type: "Message" }
    };
    const r = await resolveBc2AttachmentLinkage(query as never, att);
    expect(r.threadId).toBe("thr");
    expect(r.commentId).toBeNull();
  });
});
