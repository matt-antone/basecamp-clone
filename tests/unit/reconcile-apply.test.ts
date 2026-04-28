import { describe, expect, it, vi } from "vitest";
import { applyPlan } from "@/lib/reconcile-filenames/apply";
import type { PlanRow, ProgressFile } from "@/lib/reconcile-filenames/types";

function plan(rows: Partial<PlanRow>[]): PlanRow[] {
  return rows.map((r, i) => ({
    fileId: r.fileId ?? `f${i}`,
    projectId: r.projectId ?? "p",
    dropboxFileId: "dropboxFileId" in r ? (r.dropboxFileId ?? null) : `id:${i}`,
    fromPath: r.fromPath ?? `/p/uploads/old-${i}.pdf`,
    toPath: r.toPath ?? `/p/uploads/new-${i}.pdf`
  }));
}

function deps(overrides: Partial<Parameters<typeof applyPlan>[0]> = {}) {
  return {
    plan: plan([{}]),
    progress: {} as ProgressFile,
    concurrency: 1,
    flush: vi.fn(async () => {}),
    db: { updateDropboxPath: vi.fn(async () => {}) },
    dropbox: {
      moveFile: vi.fn(async (args: { from?: string; fromId?: string; to: string }) => ({
        path: args.to,
        fileId: args.fromId ?? "id:moved"
      }))
    },
    ...overrides
  };
}

describe("applyPlan", () => {
  it("moves the file then updates DB and marks both flags", async () => {
    const d = deps();
    const result = await applyPlan(d);
    expect(d.dropbox.moveFile).toHaveBeenCalledWith({
      fromId: "id:0",
      to: "/p/uploads/new-0.pdf"
    });
    expect(d.db.updateDropboxPath).toHaveBeenCalledWith({
      fileId: "f0",
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(d.progress["f0"]).toEqual({
      dropbox_done: true,
      db_done: true,
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.error).toBe(0);
    expect(d.flush).toHaveBeenCalled();
  });

  it("skips rows whose progress.db_done is already true", async () => {
    const d = deps({
      progress: { f0: { dropbox_done: true, db_done: true, newPath: "/p/uploads/new-0.pdf" } }
    });
    const result = await applyPlan(d);
    expect(d.dropbox.moveFile).not.toHaveBeenCalled();
    expect(d.db.updateDropboxPath).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("retries the DB update when resuming with dropbox_done but db_done=false", async () => {
    const d = deps({
      progress: {
        f0: { dropbox_done: true, db_done: false, newPath: "/p/uploads/new-0.pdf" }
      }
    });
    await applyPlan(d);
    expect(d.dropbox.moveFile).not.toHaveBeenCalled();
    expect(d.db.updateDropboxPath).toHaveBeenCalledWith({
      fileId: "f0",
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(d.progress["f0"].db_done).toBe(true);
  });

  it("uses fromPath when dropboxFileId is null", async () => {
    const d = deps({ plan: plan([{ dropboxFileId: null, fromPath: "/p/uploads/x.pdf" }]) });
    await applyPlan(d);
    expect(d.dropbox.moveFile).toHaveBeenCalledWith({
      from: "/p/uploads/x.pdf",
      to: "/p/uploads/new-0.pdf"
    });
  });

  it("marks Dropbox not_found errors as skipped without aborting", async () => {
    const notFound = Object.assign(new Error("not_found"), {
      error: { error_summary: "from_lookup/not_found/." }
    });
    const d = deps({
      plan: plan([{}, {}]),
      dropbox: {
        moveFile: vi
          .fn()
          .mockRejectedValueOnce(notFound)
          .mockResolvedValueOnce({ path: "/p/uploads/new-1.pdf", fileId: "id:1" })
      }
    });
    const result = await applyPlan(d);
    expect(result.skipped).toBe(1);
    expect(result.success).toBe(1);
    expect(d.progress["f0"].error).toMatch(/not_found/);
  });

  it("re-resolves a target conflict on the fly and retries once", async () => {
    const conflict = Object.assign(new Error("conflict"), {
      error: { error_summary: "to/conflict/file/." }
    });
    const moveFile = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ path: "/p/uploads/new-0-2.pdf", fileId: "id:0" });
    const d = deps({ dropbox: { moveFile } });
    const result = await applyPlan(d);
    expect(moveFile).toHaveBeenCalledTimes(2);
    expect(moveFile.mock.calls[1][0].to).toBe("/p/uploads/new-0-2.pdf");
    expect(result.success).toBe(1);
  });

  it("records other Dropbox errors and continues", async () => {
    const d = deps({
      plan: plan([{}, {}]),
      dropbox: {
        moveFile: vi
          .fn()
          .mockRejectedValueOnce(new Error("boom"))
          .mockResolvedValueOnce({ path: "/p/uploads/new-1.pdf", fileId: "id:1" })
      }
    });
    const result = await applyPlan(d);
    expect(result.error).toBe(1);
    expect(result.success).toBe(1);
    expect(d.progress["f0"].error).toBe("boom");
  });

  it("respects limit", async () => {
    const d = deps({ plan: plan([{}, {}, {}]), limit: 2 });
    const result = await applyPlan(d);
    expect(result.success).toBe(2);
    expect(d.dropbox.moveFile).toHaveBeenCalledTimes(2);
  });
});
