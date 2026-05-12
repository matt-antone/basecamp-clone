import { randomUUID } from "node:crypto";
import type { PhaseCtx, PhaseResult, PhaseError } from "./types";
import { resolveUserRef } from "./user-ref";

interface ProdFileRow {
  id: string;
  project_id: string;
  thread_id: string | null;
  comment_id: string | null;
  uploader_user_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  dropbox_file_id: string;
  dropbox_path: string;
  checksum: string;
  created_at: Date;
}

async function lookupMap(ctx: PhaseCtx, table: string, prodId: string): Promise<string | null> {
  const r = await ctx.test.query<{ local_id: string }>(
    `select local_id from ${table} where prod_id = $1`,
    [prodId]
  );
  return r.rows[0]?.local_id ?? null;
}

function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "project-files";
}

async function blobToBuffer(b: Blob): Promise<Buffer> {
  return Buffer.from(await b.arrayBuffer());
}

export async function runFilesPhase(ctx: PhaseCtx): Promise<PhaseResult> {
  const watermark = ctx.watermarks.get("files") ?? new Date(0);
  const limit = ctx.flags.limitPerPhase;

  const sql =
    `select id, project_id, thread_id, comment_id, uploader_user_id, filename, mime_type,
            size_bytes, dropbox_file_id, dropbox_path, checksum, created_at
       from project_files
       where created_at > $1
       order by created_at asc, id asc` +
    (limit ? ` limit ${Math.max(1, Math.floor(limit))}` : "");
  const prodRes = await ctx.prod.query<ProdFileRow>(sql, [watermark]);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: PhaseError[] = [];
  let maxSeen = watermark;

  const bucket = bucketName();

  for (const row of prodRes.rows) {
    try {
      await ctx.test.query("begin");
      const mapped = await lookupMap(ctx, "import_map_prod_files", row.id);
      if (mapped) {
        await ctx.test.query("commit");
        skipped++;
        if (row.created_at > maxSeen) maxSeen = row.created_at;
        continue;
      }

      const localProject = await lookupMap(ctx, "import_map_prod_projects", row.project_id);
      if (!localProject) throw new Error(`unresolved project ${row.project_id}`);
      const localUploader = await resolveUserRef(ctx, row.uploader_user_id);
      const localThread = row.thread_id
        ? await lookupMap(ctx, "import_map_prod_threads", row.thread_id)
        : null;
      const localComment = row.comment_id
        ? await lookupMap(ctx, "import_map_prod_comments", row.comment_id)
        : null;

      const storageKey = row.dropbox_path; // same key in both buckets
      const dl = await (ctx.prodStorage as any).storage
        .from(bucket)
        .download(storageKey);
      if (dl.error || !dl.data) throw new Error(`download failed: ${dl.error?.message ?? "no data"}`);
      const bytes = await blobToBuffer(dl.data as Blob);

      const up = await (ctx.testStorage as any).storage
        .from(bucket)
        .upload(storageKey, bytes, {
          contentType: row.mime_type,
          upsert: true,
        });
      if (up.error) throw new Error(`upload failed: ${up.error.message}`);

      const localId = randomUUID();
      await ctx.test.query(
        `insert into project_files
           (id, project_id, thread_id, comment_id, uploader_user_id, filename, mime_type,
            size_bytes, dropbox_file_id, dropbox_path, checksum, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          localId,
          localProject,
          localThread,
          localComment,
          localUploader,
          row.filename,
          row.mime_type,
          row.size_bytes,
          row.dropbox_file_id,
          row.dropbox_path,
          row.checksum,
          row.created_at,
        ]
      );
      await ctx.test.query(
        "insert into import_map_prod_files (prod_id, local_id) values ($1, $2)",
        [row.id, localId]
      );
      await ctx.test.query("commit");
      inserted++;
      if (row.created_at > maxSeen) maxSeen = row.created_at;
    } catch (e) {
      try { await ctx.test.query("rollback"); } catch { /* ignore */ }
      failed++;
      errors.push({ prodId: row.id, reason: (e as Error).message });
    }
  }

  ctx.log(
    `[files] scanned=${prodRes.rows.length} inserted=${inserted} skipped=${skipped} failed=${failed}`
  );

  return {
    entity: "files",
    scanned: prodRes.rows.length,
    inserted,
    skipped,
    failed,
    newWatermark: maxSeen,
    errors,
  };
}
