import { resolveCollision, stripPrefix } from "./strip";
import type { ErrorRow, OrphanRow, PlanRow } from "./types";

export type PlanDbRow = {
  id: string;
  project_id: string;
  dropbox_file_id: string | null;
  dropbox_path: string | null;
  storage_dir: string;
};

type PlanDeps = {
  db: { listActiveFileRows(): Promise<PlanDbRow[]> };
  dropbox: {
    listFolderEntries(path: string): Promise<Array<{
      ".tag": "file" | "folder" | "deleted";
      name: string;
      path_display: string;
    }>>;
  };
  listActiveProjectDirs?: () => Promise<Array<{ projectId: string; uploadsDir: string }>>;
  limit?: number;
};

type PlanResult = {
  plan: PlanRow[];
  orphans: OrphanRow[];
  errors: ErrorRow[];
};

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

export async function buildPlan(deps: PlanDeps): Promise<PlanResult> {
  const rows = await deps.db.listActiveFileRows();

  // Group rows by their /uploads/ directory.
  const rowsByDir = new Map<string, PlanDbRow[]>();
  const projectByDir = new Map<string, string>();
  for (const row of rows) {
    if (!row.dropbox_path) continue;
    const dir = dirname(row.dropbox_path);
    if (!rowsByDir.has(dir)) rowsByDir.set(dir, []);
    rowsByDir.get(dir)!.push(row);
    projectByDir.set(dir, row.project_id);
  }

  // Optionally also walk dirs from listActiveProjectDirs (used for orphan reporting
  // when no DB rows exist in that dir).
  if (deps.listActiveProjectDirs) {
    const extra = await deps.listActiveProjectDirs();
    for (const { projectId, uploadsDir } of extra) {
      if (!rowsByDir.has(uploadsDir)) rowsByDir.set(uploadsDir, []);
      if (!projectByDir.has(uploadsDir)) projectByDir.set(uploadsDir, projectId);
    }
  }

  const plan: PlanRow[] = [];
  const orphans: OrphanRow[] = [];
  const errors: ErrorRow[] = [];

  for (const [dir, dirRows] of rowsByDir.entries()) {
    let entries: Array<{ ".tag": "file" | "folder" | "deleted"; name: string; path_display: string }>;
    try {
      entries = await deps.dropbox.listFolderEntries(dir);
    } catch (error) {
      errors.push({
        projectId: projectByDir.get(dir) ?? "",
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const taken = new Set<string>();
    for (const e of entries) {
      if (e[".tag"] === "file") taken.add(e.name);
    }

    const dbBasenamesInDir = new Set(
      dirRows.map((r) => (r.dropbox_path ? basename(r.dropbox_path) : ""))
    );

    // Plan renames for matching DB rows.
    for (const row of dirRows) {
      if (!row.dropbox_path) continue;
      const fromBasename = basename(row.dropbox_path);
      const cleanName = stripPrefix(fromBasename);
      if (!cleanName) continue;
      // Remove the source name from `taken` so a row can rename to its own clean form
      // even if the directory currently has both the prefixed and clean variants.
      taken.delete(fromBasename);
      const target = resolveCollision(cleanName, taken);
      plan.push({
        fileId: row.id,
        projectId: row.project_id,
        dropboxFileId: row.dropbox_file_id,
        fromPath: row.dropbox_path,
        toPath: `${dir}/${target}`
      });
    }

    // Orphans: prefixed Dropbox files with no DB row in this dir.
    for (const e of entries) {
      if (e[".tag"] !== "file") continue;
      if (dbBasenamesInDir.has(e.name)) continue;
      if (stripPrefix(e.name) === null) continue;
      orphans.push({
        projectId: projectByDir.get(dir) ?? "",
        path: e.path_display,
        basename: e.name
      });
    }
  }

  const limited = typeof deps.limit === "number" ? plan.slice(0, deps.limit) : plan;
  return { plan: limited, orphans, errors };
}
