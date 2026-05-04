#!/usr/bin/env npx tsx
// scripts/seed-clients-from-prod.ts

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool } from "pg";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

interface ClientRow {
  id: string;
  code: string;
  name: string;
}

async function main() {
  const prodUrl = requireEnv("PROD_DATABASE_URL");
  const targetUrl = requireEnv("DATABASE_URL");

  if (prodUrl === targetUrl) {
    console.error("PROD_DATABASE_URL must NOT equal DATABASE_URL — refusing to seed onto production.");
    process.exit(1);
  }

  const prod = new Pool({ connectionString: prodUrl });
  const target = new Pool({ connectionString: targetUrl });

  process.stdout.write("Fetching clients from production...\n");
  const prodRes = await prod.query<ClientRow>("select id, code, name from clients order by code");
  process.stdout.write(`  ${prodRes.rows.length} clients fetched\n`);

  let inserted = 0;
  let skipped = 0;
  for (const row of prodRes.rows) {
    const exists = await target.query<{ id: string }>(
      "select id from clients where lower(code) = lower($1) limit 1",
      [row.code]
    );
    if (exists.rows.length > 0) {
      skipped++;
      continue;
    }
    await target.query(
      "insert into clients (id, code, name) values ($1, $2, $3)",
      [row.id, row.code, row.name]
    );
    inserted++;
  }

  await prod.end();
  await target.end();

  process.stdout.write(`\nDone. Inserted: ${inserted}, Skipped (already exist): ${skipped}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
