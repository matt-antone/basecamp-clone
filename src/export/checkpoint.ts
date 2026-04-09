import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CheckpointEntry = {
  key: string;
  completedAt: string;
  metadata?: Record<string, unknown>;
};

export type ExportCheckpoint = {
  schemaVersion: string;
  updatedAt: string;
  completed: Record<string, CheckpointEntry>;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class CheckpointStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ExportCheckpoint | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ExportCheckpoint;

      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.schemaVersion !== "string" ||
        !parsed.completed ||
        typeof parsed.completed !== "object"
      ) {
        throw new Error("Checkpoint file has invalid shape.");
      }

      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  async save(checkpoint: ExportCheckpoint): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;

    const payload: ExportCheckpoint = {
      ...checkpoint,
      updatedAt: nowIso()
    };

    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  async markCompleted(
    key: string,
    metadata?: Record<string, unknown>
  ): Promise<ExportCheckpoint> {
    const current =
      (await this.load()) ??
      ({
        schemaVersion: "1.0.0",
        updatedAt: nowIso(),
        completed: {}
      } satisfies ExportCheckpoint);

    current.completed[key] = {
      key,
      completedAt: nowIso(),
      metadata
    };

    await this.save(current);
    return current;
  }

  async reset(): Promise<void> {
    await rm(this.filePath, { force: true });
    await rm(`${this.filePath}.tmp`, { force: true });
  }
}
