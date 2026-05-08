import { promises as fs } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { formatDecisionCsv } from "@/lib/imports/orphans/csv";
import type { OrphanDecision } from "@/lib/imports/orphans/types";

config({ path: resolve(process.cwd(), ".env.local") });

interface DumpFlags {
  auditCsvPath: string;
  outPath: string;
  force: boolean;
}

function parseFlags(argv: string[]): DumpFlags {
  const flags: DumpFlags = {
    auditCsvPath: "tmp/audit/projects.csv",
    outPath: "docs/imports/bc2-orphan-decisions.csv",
    force: false,
  };
  for (const a of argv) {
    if (a.startsWith("--audit-csv=")) flags.auditCsvPath = a.slice("--audit-csv=".length);
    else if (a.startsWith("--out=")) flags.outPath = a.slice("--out=".length);
    else if (a === "--force") flags.force = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
}

function parseAuditLine(line: string): string[] {
  // Reuse the same parser shape as csv.ts but inline a minimal version to avoid
  // importing internal helpers. Fields here are simple enough that the tests
  // exercise the outputs end-to-end.
  const out: string[] = [];
  let i = 0;
  let field = "";
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field.length === 0) { inQuotes = true; i++; continue; }
    if (c === ",") { out.push(field); field = ""; i++; continue; }
    field += c; i++;
  }
  out.push(field);
  return out;
}

export async function dumpOrphanDecisions(args: {
  auditCsvPath: string;
  outPath: string;
  force: boolean;
}): Promise<{ count: number }> {
  const text = await fs.readFile(args.auditCsvPath, "utf8");
  const rows = text.split(/\r?\n/).filter((r) => r.length > 0);
  if (rows.length === 0) {
    throw new Error(`audit CSV is empty: ${args.auditCsvPath}`);
  }
  const header = parseAuditLine(rows[0]).map((s) => s.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const bc2 = idx("bc2_id");
  const name = idx("name");
  const status = idx("status");
  if (bc2 < 0 || name < 0 || status < 0) {
    throw new Error(
      `audit CSV missing required columns (need bc2_id, name, status): ${header.join(",")}`,
    );
  }

  if (!args.force) {
    try {
      await fs.access(args.outPath);
      throw new Error(`out-file already exists: ${args.outPath} (rerun with --force to overwrite)`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  const decisions: OrphanDecision[] = [];
  for (let r = 1; r < rows.length; r++) {
    const fields = parseAuditLine(rows[r]);
    if ((fields[status] ?? "").trim() !== "failed") continue;
    decisions.push({
      bc2Id: (fields[bc2] ?? "").trim(),
      title: fields[name] ?? "",
      action: "",
      code: "",
      clientName: "",
    });
  }

  await fs.mkdir(resolve(args.outPath, ".."), { recursive: true });
  await fs.writeFile(args.outPath, formatDecisionCsv(decisions), "utf8");
  return { count: decisions.length };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const r = await dumpOrphanDecisions(flags);
  console.log(
    `[dump-orphan-decisions] wrote ${r.count} rows to ${flags.outPath}.`,
  );
  console.log(
    `Edit the file, then run: pnpm apply:orphan-decisions --i-have-a-backup [--run-phases]`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[dump-orphan-decisions] fatal: ${err.message ?? err}`);
    process.exit(1);
  });
}
