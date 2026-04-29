import { resolveCollision } from "./strip";
import type { PlanRow, ProgressFile } from "./types";

type ApplyDeps = {
  plan: PlanRow[];
  progress: ProgressFile;
  concurrency?: number;
  limit?: number;
  flush: () => Promise<void>;
  onFlushError?: (err: unknown) => void;
  db: {
    updateDropboxPath(args: { fileId: string; newPath: string }): Promise<void>;
  };
  dropbox: {
    moveFile(args: {
      from?: string;
      fromId?: string;
      to: string;
      autorename?: boolean;
    }): Promise<{ path: string; fileId?: string }>;
    listFolderEntries(path: string): Promise<Array<{ ".tag": string; name: string }>>;
  };
};

type ApplyResult = {
  success: number;
  skipped: number;
  error: number;
  flushErrors: number;
};

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function isFromLookupNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const summary = (err as { error?: { error_summary?: string } }).error?.error_summary;
  return typeof summary === "string" && summary.startsWith("from_lookup/not_found");
}

function isToConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const summary = (err as { error?: { error_summary?: string } }).error?.error_summary;
  return typeof summary === "string" && summary.startsWith("to/conflict");
}

export async function applyPlan(deps: ApplyDeps): Promise<ApplyResult> {
  const limit = typeof deps.limit === "number" ? deps.plan.slice(0, deps.limit) : deps.plan;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const queue = [...limit];
  const result: ApplyResult = { success: 0, skipped: 0, error: 0, flushErrors: 0 };

  let flushChain: Promise<void> = Promise.resolve();
  const scheduleFlush = () => {
    flushChain = flushChain.then(() => deps.flush()).catch((err) => {
      result.flushErrors += 1;
      deps.onFlushError?.(err);
    });
    return flushChain;
  };

  async function processRow(row: PlanRow) {
    const existing = deps.progress[row.fileId];
    if (existing?.db_done) {
      result.skipped += 1;
      return;
    }

    let newPath = existing?.newPath;
    if (!existing?.dropbox_done) {
      try {
        const moved = await deps.dropbox.moveFile(
          row.dropboxFileId
            ? { fromId: row.dropboxFileId, to: row.toPath }
            : { from: row.fromPath, to: row.toPath }
        );
        newPath = moved.path;
        deps.progress[row.fileId] = { dropbox_done: true, db_done: false, newPath };
        await scheduleFlush();
      } catch (err) {
        if (isFromLookupNotFound(err)) {
          deps.progress[row.fileId] = {
            dropbox_done: false,
            db_done: false,
            error: err instanceof Error ? err.message : String(err)
          };
          await scheduleFlush();
          result.skipped += 1;
          return;
        }
        if (isToConflict(err)) {
          // Re-resolve against current Dropbox listing of the destination dir.
          const dir = dirname(row.toPath);
          const taken = new Set<string>();
          const entries = await deps.dropbox.listFolderEntries(dir);
          for (const e of entries) {
            if (e[".tag"] === "file") taken.add(e.name);
          }
          const newName = resolveCollision(basename(row.toPath), taken);
          const retryTo = `${dir}/${newName}`;
          try {
            const moved = await deps.dropbox.moveFile(
              row.dropboxFileId
                ? { fromId: row.dropboxFileId, to: retryTo }
                : { from: row.fromPath, to: retryTo }
            );
            newPath = moved.path;
            deps.progress[row.fileId] = { dropbox_done: true, db_done: false, newPath };
            await scheduleFlush();
          } catch (retryErr) {
            deps.progress[row.fileId] = {
              dropbox_done: false,
              db_done: false,
              error: retryErr instanceof Error ? retryErr.message : String(retryErr)
            };
            await scheduleFlush();
            result.error += 1;
            return;
          }
        } else {
          deps.progress[row.fileId] = {
            dropbox_done: false,
            db_done: false,
            error: err instanceof Error ? err.message : String(err)
          };
          await scheduleFlush();
          result.error += 1;
          return;
        }
      }
    }

    if (!newPath) {
      result.error += 1;
      return;
    }

    try {
      await deps.db.updateDropboxPath({ fileId: row.fileId, newPath });
      deps.progress[row.fileId] = {
        dropbox_done: true,
        db_done: true,
        newPath
      };
      await scheduleFlush();
      result.success += 1;
    } catch (err) {
      deps.progress[row.fileId] = {
        dropbox_done: true,
        db_done: false,
        newPath,
        error: err instanceof Error ? err.message : String(err)
      };
      await scheduleFlush();
      result.error += 1;
    }
  }

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;
      await processRow(row);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await flushChain;
  return result;
}
