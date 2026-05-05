// lib/imports/migration/threads.ts
import { createThread, createComment } from "@/lib/repositories";
import { parseBc2IsoTimestamptz } from "../bc2-fetcher";
import type { DumpReader } from "../dump-reader";
import { logRecord, type DataSource, type Query } from "./jobs";
import type { MigratedProject } from "./types";

const SUPPORTED_TOPICS = new Set([
  "Message",
  "Todolist",
  "Upload",
  "Document",
]);

interface Bc2TopicSummary {
  id: number;
  title?: string;
  topicable: { id: number; type: string };
}

interface Bc2CommentShape {
  id: number;
  content?: string;
  creator?: { id: number; name?: string };
  created_at?: string;
}

interface Bc2ThreadDetail {
  id: number;
  subject?: string;
  title?: string;
  content?: string;
  body?: string;
  creator?: { id: number; name?: string };
  created_at?: string;
  comments?: Bc2CommentShape[];
}

export async function migrateThreadsAndComments(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  project: MigratedProject;
  personMap: Map<number, string>;
}): Promise<{ threads: { success: number; failed: number; skipped: number } }> {
  const { reader, q, jobId, project, personMap } = args;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  let topicsRes;
  try {
    topicsRes = await reader.topics(project.bc2Id);
  } catch (err) {
    await logRecord(q, {
      jobId,
      recordType: "thread",
      sourceId: String(project.bc2Id),
      status: "failed",
      message: `topics_fetch_failed: ${err instanceof Error ? err.message : String(err)}`,
      dataSource: "api",
    });
    return { threads: { success: 0, failed: 1, skipped: 0 } };
  }
  const topics = (Array.isArray(topicsRes.body) ? topicsRes.body : []) as Bc2TopicSummary[];
  const topicsDataSource: DataSource = topicsRes.source;

  for (const topic of topics) {
    const t = topic.topicable;
    if (!t || !SUPPORTED_TOPICS.has(t.type)) {
      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t?.id ?? topic.id),
        status: "failed",
        message: `skipped_topicable_type=${t?.type ?? "unknown"}`,
        dataSource: topicsDataSource,
      });
      skipped++;
      continue;
    }

    let detailDataSource: DataSource = topicsDataSource;
    try {
      const detailRes = await reader.topicDetail(project.bc2Id, t.type, t.id);
      detailDataSource = detailRes.source;
      const detail = (detailRes.body ?? {}) as Bc2ThreadDetail;

      // Idempotency: re-use mapped thread if present
      const existing = await q<{ local_thread_id: string }>(
        "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
        [String(t.id)],
      );

      let localThreadId: string;
      if (existing.rows[0]) {
        localThreadId = existing.rows[0].local_thread_id;
      } else {
        const creatorId = detail.creator?.id;
        const authorUserId =
          (creatorId != null ? personMap.get(creatorId) : undefined) ?? `dry_${creatorId ?? "unknown"}`;
        const created = await createThread({
          projectId: project.localId,
          title: detail.subject ?? detail.title ?? topic.title ?? "(untitled)",
          bodyMarkdown: detail.content ?? detail.body ?? "",
          authorUserId,
          sourceCreatedAt: parseBc2IsoTimestamptz(detail.created_at) ?? undefined,
        });
        localThreadId = (created as { id: string }).id;
        await q(
          "insert into import_map_threads (basecamp_thread_id, local_thread_id) values ($1, $2)",
          [String(t.id), localThreadId],
        );
      }

      // Comments embedded in topic detail
      for (const cmt of detail.comments ?? []) {
        try {
          const cmtExisting = await q<{ local_comment_id: string }>(
            "select local_comment_id from import_map_comments where basecamp_comment_id = $1",
            [String(cmt.id)],
          );
          if (cmtExisting.rows[0]) continue;

          const creatorId = cmt.creator?.id;
          const authorUserId =
            (creatorId != null ? personMap.get(creatorId) : undefined) ?? `dry_${creatorId ?? "unknown"}`;
          const createdComment = await createComment({
            projectId: project.localId,
            threadId: localThreadId,
            bodyMarkdown: cmt.content ?? "",
            authorUserId,
            sourceCreatedAt: parseBc2IsoTimestamptz(cmt.created_at) ?? undefined,
          });
          const localCommentId = (createdComment as { id: string }).id;
          await q(
            "insert into import_map_comments (basecamp_comment_id, local_comment_id) values ($1, $2)",
            [String(cmt.id), localCommentId],
          );
          await logRecord(q, {
            jobId,
            recordType: "comment",
            sourceId: String(cmt.id),
            status: "success",
            dataSource: detailDataSource,
          });
        } catch (err) {
          await logRecord(q, {
            jobId,
            recordType: "comment",
            sourceId: String(cmt.id),
            status: "failed",
            message: err instanceof Error ? err.message : String(err),
            dataSource: detailDataSource,
          });
          failed++;
        }
      }

      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t.id),
        status: "success",
        dataSource: detailDataSource,
      });
      success++;
    } catch (err) {
      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource: detailDataSource,
      });
      failed++;
    }
  }

  return { threads: { success, failed, skipped } };
}
