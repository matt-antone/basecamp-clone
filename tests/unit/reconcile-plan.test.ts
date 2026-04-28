import { describe, expect, it, vi } from "vitest";
import { buildPlan } from "@/lib/reconcile-filenames/plan";

type DbRow = {
  id: string;
  project_id: string;
  dropbox_file_id: string | null;
  dropbox_path: string | null;
  storage_dir: string;
};

function makeDeps(rows: DbRow[], dirListings: Record<string, string[]>) {
  return {
    db: {
      listActiveFileRows: vi.fn(async () => rows)
    },
    dropbox: {
      listFolderEntries: vi.fn(async (path: string) =>
        (dirListings[path] ?? []).map((name) => ({
          ".tag": "file" as const,
          name,
          path_display: `${path}/${name}`
        }))
      )
    }
  };
}

describe("buildPlan", () => {
  it("plans a rename for a prefixed file with no collision", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/Projects/ACME/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/Projects/ACME"
      }
    ];
    const deps = makeDeps(rows, {
      "/Projects/ACME/uploads": ["1775067993312-521625632-foo.pdf"]
    });
    const result = await buildPlan(deps);
    expect(result.plan).toEqual([
      {
        fileId: "f1",
        projectId: "p1",
        dropboxFileId: "id:1",
        fromPath: "/Projects/ACME/uploads/1775067993312-521625632-foo.pdf",
        toPath: "/Projects/ACME/uploads/foo.pdf"
      }
    ]);
    expect(result.orphans).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("auto-suffixes when target name already exists in the directory", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993312-521625632-foo.pdf", "foo.pdf"]
    });
    const result = await buildPlan(deps);
    expect(result.plan[0].toPath).toBe("/p/uploads/foo-2.pdf");
  });

  it("auto-suffixes when two planned rows collapse to the same name", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993311-100-foo.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p1",
        dropbox_file_id: "id:2",
        dropbox_path: "/p/uploads/1775067993312-200-foo.pdf",
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993311-100-foo.pdf", "1775067993312-200-foo.pdf"]
    });
    const result = await buildPlan(deps);
    const targets = result.plan.map((r) => r.toPath);
    expect(targets).toEqual(["/p/uploads/foo.pdf", "/p/uploads/foo-2.pdf"]);
  });

  it("skips rows whose basename does not match the prefix pattern", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/clean.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p1",
        dropbox_file_id: "id:2",
        dropbox_path: null,
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, { "/p/uploads": ["clean.pdf"] });
    const result = await buildPlan(deps);
    expect(result.plan).toEqual([]);
  });

  it("reports orphan prefixed files in Dropbox with no DB row", async () => {
    const rows: DbRow[] = [];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993312-521625632-orphan.pdf", "clean.pdf"]
    });
    const result = await buildPlan({
      ...deps,
      listActiveProjectDirs: async () => [{ projectId: "p1", uploadsDir: "/p/uploads" }]
    });
    expect(result.orphans).toEqual([
      {
        projectId: "p1",
        path: "/p/uploads/1775067993312-521625632-orphan.pdf",
        basename: "1775067993312-521625632-orphan.pdf"
      }
    ]);
  });

  it("captures listFolderEntries failures per-project without aborting", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p2",
        dropbox_file_id: "id:2",
        dropbox_path: "/q/uploads/1775067993312-521625632-bar.pdf",
        storage_dir: "/q"
      }
    ];
    const deps = {
      db: { listActiveFileRows: vi.fn(async () => rows) },
      dropbox: {
        listFolderEntries: vi.fn(async (path: string) => {
          if (path === "/q/uploads") throw new Error("rate limited");
          return [{ ".tag": "file" as const, name: "1775067993312-521625632-foo.pdf", path_display: `${path}/1775067993312-521625632-foo.pdf` }];
        })
      }
    };
    const result = await buildPlan(deps);
    expect(result.plan.map((r) => r.projectId)).toEqual(["p1"]);
    expect(result.errors).toEqual([{ projectId: "p2", error: "rate limited" }]);
  });

  it("respects --limit by truncating the plan after collision resolution", async () => {
    const rows: DbRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`,
      project_id: "p1",
      dropbox_file_id: `id:${i}`,
      dropbox_path: `/p/uploads/1775067993312-${i}-doc${i}.pdf`,
      storage_dir: "/p"
    }));
    const deps = makeDeps(rows, {
      "/p/uploads": rows.map((r) => r.dropbox_path!.split("/").pop()!)
    });
    const result = await buildPlan({ ...deps, limit: 2 });
    expect(result.plan).toHaveLength(2);
  });
});
