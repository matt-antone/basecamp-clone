#!/usr/bin/env npx tsx
// scripts/dump-bc2-titles.ts

import { config } from "dotenv";
import { resolve, dirname } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, rename, writeFile } from "fs/promises";
import { Bc2Client } from "../lib/imports/bc2-client";
import { Bc2Fetcher, type Bc2Project, type Bc2ProjectSource } from "../lib/imports/bc2-fetcher";

interface CliFlags {
  source: Bc2ProjectSource;
  out: string;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=").slice(1).join("=") : null;
  };
  const rawSource = (get("source") ?? "all") as string;
  if (rawSource !== "active" && rawSource !== "archived" && rawSource !== "all") {
    console.error(`Unknown --source=${rawSource}. Use active | archived | all.`);
    process.exit(1);
  }
  return {
    source: rawSource as Bc2ProjectSource,
    out: get("out") ?? "tmp/bc2-titles.json"
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

interface DumpRecord {
  id: number;
  name: string;
  archived: boolean;
  created_at: string;
}

interface DumpFile {
  generated_at: string;
  source: Bc2ProjectSource;
  count: number;
  records: DumpRecord[];
}

async function main() {
  const flags = parseFlags();

  const accountId = requireEnv("BASECAMP_ACCOUNT_ID");
  const username = requireEnv("BASECAMP_USERNAME");
  const password = requireEnv("BASECAMP_PASSWORD");
  const userAgent = requireEnv("BASECAMP_USER_AGENT");
  const delayMs = parseInt(process.env.BASECAMP_REQUEST_DELAY_MS ?? "200", 10);

  const client = new Bc2Client({ accountId, username, password, userAgent, requestDelayMs: delayMs });
  const fetcher = new Bc2Fetcher(client);

  process.stdout.write(`Fetching BC2 projects (source=${flags.source})...\n`);

  const records: DumpRecord[] = [];
  let warnCount = 0;

  for await (const p of fetcher.fetchProjects({ source: flags.source }) as AsyncGenerator<Bc2Project>) {
    if (typeof p.id !== "number" || typeof p.name !== "string") {
      warnCount++;
      process.stderr.write(`  warn: malformed record skipped: ${JSON.stringify(p)}\n`);
      continue;
    }
    records.push({
      id: p.id,
      name: p.name,
      archived: p.archived === true,
      created_at: p.created_at
    });
    if (records.length % 100 === 0) {
      process.stdout.write(`  ...${records.length} fetched\n`);
    }
  }

  const dump: DumpFile = {
    generated_at: new Date().toISOString(),
    source: flags.source,
    count: records.length,
    records
  };

  const outPath = resolve(process.cwd(), flags.out);
  const tmpPath = `${outPath}.tmp`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(dump, null, 2), "utf-8");
  await rename(tmpPath, outPath);

  process.stdout.write(`\nDone. ${records.length} records written to ${outPath}\n`);
  if (warnCount > 0) process.stdout.write(`Warnings: ${warnCount} malformed records skipped\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
