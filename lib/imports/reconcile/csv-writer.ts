// lib/imports/reconcile/csv-writer.ts
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

export interface CsvWriter {
  open(filename: string, header: string[]): Promise<void>;
  row(filename: string, values: (string | number | null)[]): Promise<void>;
  close(): Promise<void>;
}

export async function createCsvWriter(outDir: string): Promise<CsvWriter> {
  await fs.mkdir(outDir, { recursive: true });
  const handles = new Map<string, FileHandle>();

  function quote(v: string | number | null): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  return {
    async open(filename, header) {
      if (handles.has(filename)) return;
      const h = await fs.open(join(outDir, filename), "w");
      await h.write(header.map(quote).join(",") + "\n");
      handles.set(filename, h);
    },
    async row(filename, values) {
      const h = handles.get(filename);
      if (!h) throw new Error(`csv not open: ${filename}`);
      await h.write(values.map(quote).join(",") + "\n");
    },
    async close() {
      for (const h of handles.values()) await h.close();
      handles.clear();
    },
  };
}
