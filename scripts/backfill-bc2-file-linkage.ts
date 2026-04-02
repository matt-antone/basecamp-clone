#!/usr/bin/env npx tsx
// scripts/backfill-bc2-file-linkage.ts
// One-time: set thread_id / comment_id on orphan project_files rows using BC2 attachment JSON (attachable).

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool, type QueryResultRow } from "pg";
import { Bc2Client } from "../lib/imports/bc2-client";
import {
  resolveBc2LinkageFromAttachable,
  type QueryFn
} from "../lib/imports/bc2-attachment-linkage";
import type { Bc2Attachment } from "../lib/imports/bc2-fetcher";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

const q = query as QueryFn;

function parseFlags() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find(a => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=")[1] : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);
  return {
    dryRun: !has("confirm"),
    limit: parseInt(get("limit") ?? "100", 10),
    confirm: has("confirm"),
    projectId: get("project-id")
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const flags = parseFlags();

  if (!flags.confirm) {
    console.log(
      "[backfill-bc2-file-linkage] DRY RUN (no DB updates). Pass --confirm to apply changes."
    );
  } else {
    console.log("[backfill-bc2-file-linkage] APPLY mode — updating project_files.");
  }

  const accountId = requireEnv("BASECAMP_ACCOUNT_ID");
  const username = requireEnv("BASECAMP_USERNAME");
  const password = requireEnv("BASECAMP_PASSWORD");
  const userAgent = requireEnv("BASECAMP_USER_AGENT");
  const delayMs = parseInt(process.env.BASECAMP_REQUEST_DELAY_MS ?? "200", 10);

  const client = new Bc2Client({ accountId, username, password, userAgent, requestDelayMs: delayMs });

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const dryRunSinglePass = flags.dryRun;
  // Track file IDs that have no resolvable BC2 linkage so we don't re-fetch them.
  const unresolvableIds = new Set<string>();
  let batch = 0;
  while (true) {
    batch++;
    const hasExclusions = unresolvableIds.size > 0;
    const excludeClause = hasExclusions ? `and pf.id != all($3::uuid[])` : "";
    const queryParams: unknown[] = [flags.limit, flags.projectId];
    if (hasExclusions) queryParams.push(Array.from(unresolvableIds));
    const orphanRows = await query<{
      file_id: string;
      basecamp_project_id: string;
      basecamp_file_id: string;
    }>(
      `select pf.id as file_id,
              imp.basecamp_project_id,
              coalesce(imf.basecamp_file_id, pf.bc_attachment_id) as basecamp_file_id
         from project_files pf
         left join lateral (
           select imf.basecamp_file_id
             from import_map_files imf
            where imf.local_file_id = pf.id
            order by imf.created_at desc
            limit 1
         ) imf on true
         join projects p on p.id = pf.project_id
         join import_map_projects imp on imp.local_project_id = p.id
        where pf.thread_id is null
          and coalesce(imf.basecamp_file_id, pf.bc_attachment_id) is not null
          and ($2::uuid is null or pf.project_id = $2::uuid)
          ${excludeClause}
        order by pf.created_at
        limit $1`,
      queryParams
    );

    if (batch === 1) {
      console.log(`Candidates (BC2-mapped files with missing linkage): ${orphanRows.rows.length}`);
    } else {
      console.log(`Batch ${batch} candidates: ${orphanRows.rows.length}`);
    }

    if (orphanRows.rows.length === 0) {
      break;
    }

    for (const row of orphanRows.rows) {
      const path = `/projects/${row.basecamp_project_id}/attachments/${row.basecamp_file_id}.json`;
      try {
        const { body } = await client.get<Bc2Attachment>(path);
        const { threadId, commentId } = await resolveBc2LinkageFromAttachable(q, body.attachable);

        if (!threadId && !commentId) {
          console.log(
            `  skip file ${row.file_id} (bc file ${row.basecamp_file_id}): no resolvable Message/Comment attachable`
          );
          unresolvableIds.add(row.file_id);
          skipped++;
          continue;
        }

        if (!threadId && commentId) {
          // Should not happen for valid FK (comment implies thread)
          console.warn(`  odd: comment without thread for ${row.file_id}, skipping`);
          unresolvableIds.add(row.file_id);
          skipped++;
          continue;
        }

        if (flags.dryRun) {
          console.log(
            `  [dry-run] would update ${row.file_id} (bc ${row.basecamp_file_id}) → thread=${threadId} comment=${commentId ?? "null"}`
          );
          updated++;
          continue;
        }

        const updateResult = await query(
          `update project_files
              set thread_id = coalesce(thread_id, $2::uuid),
                  comment_id = coalesce(comment_id, $3::uuid)
            where id = $1::uuid
              and thread_id is null`,
          [row.file_id, threadId, commentId]
        );
        if ((updateResult as { rowCount?: number }).rowCount === 0) {
          skipped++;
          console.log(`  skip ${row.file_id} (already linked by another run)`);
          continue;
        }
        console.log(`  updated ${row.file_id} (bc file ${row.basecamp_file_id})`);
        updated++;
      } catch (err) {
        failed++;
        unresolvableIds.add(row.file_id);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  FAIL file ${row.file_id} (bc ${row.basecamp_file_id}): ${msg}`);
      }
    }

    if (dryRunSinglePass) {
      break;
    }
  }

  console.log(
    `\nDone — ${flags.dryRun ? "dry-run rows logged" : "applied"}: ${updated}, skipped: ${skipped}, failed: ${failed}`
  );

  await pool.end();
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
