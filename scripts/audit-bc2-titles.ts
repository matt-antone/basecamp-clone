#!/usr/bin/env npx tsx
// scripts/audit-bc2-titles.ts

import { config } from "dotenv";
import { resolve, dirname } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import {
  classifyTitle,
  type Classification,
  type Flag,
  type PrimaryClass
} from "../lib/imports/bc2-title-classifier";

interface CliFlags {
  in: string;
  outCsv: string;
  outJson: string;
  clientsFromDb: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=").slice(1).join("=") : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);
  return {
    in: get("in") ?? "tmp/bc2-titles.json",
    outCsv: get("out-csv") ?? "tmp/bc2-title-audit.csv",
    outJson: get("out-json") ?? "tmp/bc2-title-audit.json",
    clientsFromDb: has("clients-from-db")
  };
}

interface DumpRecord {
  id: number;
  name: string;
  archived: boolean;
  created_at: string;
}

interface DumpFile {
  generated_at: string;
  source: string;
  count: number;
  records: DumpRecord[];
}

interface AuditRow extends DumpRecord {
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

interface DuplicateGroup {
  code: string;
  num: string;
  bc2_ids: number[];
  raw_titles: string[];
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function loadKnownClientCodes(): Promise<Set<string> | null> {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query<{ code: string }>("select code from clients");
    await pool.end();
    return new Set(res.rows.map((r) => r.code.toUpperCase()));
  } catch (err) {
    process.stderr.write(`  warn: --clients-from-db requested but DB query failed: ${(err as Error).message}\n`);
    return null;
  }
}

async function main() {
  const flags = parseFlags();
  const inPath = resolve(process.cwd(), flags.in);
  if (!existsSync(inPath)) {
    console.error(`Input dump not found: ${inPath}`);
    console.error("Run scripts/dump-bc2-titles.ts first to produce the dump.");
    process.exit(1);
  }

  const dump: DumpFile = JSON.parse(await readFile(inPath, "utf-8"));
  process.stdout.write(`Loaded ${dump.count} records from ${inPath}\n`);

  const knownCodes = flags.clientsFromDb ? await loadKnownClientCodes() : null;

  const rows: AuditRow[] = dump.records.map((rec) => {
    const c: Classification = classifyTitle(rec.name);
    const flagsList: Flag[] = [...c.flags];
    if (knownCodes && c.code && !knownCodes.has(c.code.toUpperCase())) {
      flagsList.push("unknown-client-code");
    }
    return { ...rec, primaryClass: c.primaryClass, flags: flagsList, code: c.code, num: c.num, parsedTitle: c.parsedTitle };
  });

  // Duplicate detection: bucket by `${code}|${num}`, only emit groups of size > 1.
  const buckets = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.code || !r.num) continue;
    const key = `${r.code}|${r.num}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const [code, num] = key.split("|");
    duplicates.push({
      code,
      num,
      bc2_ids: list.map((r) => r.id),
      raw_titles: list.map((r) => r.name)
    });
    for (const r of list) {
      if (!r.flags.includes("duplicate-code-num")) r.flags.push("duplicate-code-num");
    }
  }

  // CSV
  const csvHeader = ["bc2_id", "raw_title", "primary_class", "flags", "code", "num", "parsed_title", "archived", "created_at"];
  const csvLines = [csvHeader.join(",")];
  for (const r of rows) {
    csvLines.push([
      String(r.id),
      csvEscape(r.name),
      r.primaryClass,
      csvEscape(r.flags.join(";")),
      r.code ?? "",
      r.num ?? "",
      csvEscape(r.parsedTitle),
      String(r.archived),
      r.created_at
    ].join(","));
  }

  // JSON
  const counts: Record<string, number> = {};
  const byClass: Record<string, AuditRow[]> = {};
  for (const r of rows) {
    counts[r.primaryClass] = (counts[r.primaryClass] ?? 0) + 1;
    (byClass[r.primaryClass] = byClass[r.primaryClass] ?? []).push(r);
  }

  const jsonOut = {
    generated_at: new Date().toISOString(),
    source_dump: { generated_at: dump.generated_at, source: dump.source, count: dump.count },
    total: rows.length,
    counts,
    by_class: byClass,
    duplicates
  };

  const csvPath = resolve(process.cwd(), flags.outCsv);
  const jsonPath = resolve(process.cwd(), flags.outJson);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(csvPath + ".tmp", csvLines.join("\n") + "\n", "utf-8");
  await rename(csvPath + ".tmp", csvPath);
  await writeFile(jsonPath + ".tmp", JSON.stringify(jsonOut, null, 2), "utf-8");
  await rename(jsonPath + ".tmp", jsonPath);

  // Stdout summary
  process.stdout.write("\n--- Summary ---\n");
  process.stdout.write(`Total: ${rows.length}\n\n`);
  const classOrder = Object.keys(counts).sort((a, b) => {
    if (a === "clean") return -1;
    if (b === "clean") return 1;
    return counts[b] - counts[a];
  });
  for (const cls of classOrder) {
    process.stdout.write(`  ${cls.padEnd(20)} ${counts[cls]}\n`);
  }
  process.stdout.write("\n--- Top 10 per non-clean class ---\n");
  for (const cls of classOrder) {
    if (cls === "clean") continue;
    const top = (byClass[cls] ?? []).slice(0, 10);
    if (top.length === 0) continue;
    process.stdout.write(`\n[${cls}]\n`);
    for (const r of top) process.stdout.write(`  ${r.id}  ${JSON.stringify(r.name)}\n`);
  }
  if (duplicates.length > 0) {
    process.stdout.write(`\n--- Duplicates: ${duplicates.length} groups ---\n`);
    for (const d of duplicates.slice(0, 10)) {
      process.stdout.write(`  ${d.code}-${d.num}: ids=${d.bc2_ids.join(",")}\n`);
    }
  }
  process.stdout.write(`\nWrote:\n  ${csvPath}\n  ${jsonPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
