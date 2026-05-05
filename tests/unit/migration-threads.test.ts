// tests/unit/migration-threads.test.ts
import { describe, it, expect, vi } from "vitest";
import { migrateThreadsAndComments } from "@/lib/imports/migration/threads";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

vi.mock("@/lib/repositories", () => ({
  createThread: vi.fn(async () => ({ id: "thread-uuid" })),
  createComment: vi.fn(async () => ({ id: "comment-uuid" })),
}));

function stubReader(): DumpReader {
  return {
    people: vi.fn(),
    activeProjects: vi.fn(),
    archivedProjects: vi.fn(),
    topics: vi.fn(async () => ({
      source: "dump",
      body: [
        { id: 1, title: "T1", topicable: { id: 11, type: "Message" } },
        { id: 2, title: "T2", topicable: { id: 22, type: "CalendarEvent" } },
      ],
    })),
    topicDetail: vi.fn(async (_p: number, type: string, id: number) => ({
      source: "dump",
      body: {
        id,
        subject: `subject-${id}`,
        content: "<p>hi</p>",
        creator: { id: 1, name: "A" },
        created_at: "2024-01-01T00:00:00.000Z",
        comments: [
          {
            id: 999,
            content: "yo",
            creator: { id: 1, name: "A" },
            created_at: "2024-01-02T00:00:00.000Z",
          },
        ],
      },
    })),
    attachments: vi.fn(),
  } as unknown as DumpReader;
}

function fakeQuery() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migrateThreadsAndComments", () => {
  it("imports Message topics, skips CalendarEvent with logged skip", async () => {
    const { calls, q } = fakeQuery();
    const reader = stubReader();
    const out = await migrateThreadsAndComments({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      personMap: new Map([[1, "user-1"]]),
    });

    expect(out.threads.success).toBe(1);
    expect(out.threads.skipped).toBe(1);
    expect(out.threads.failed).toBe(0);

    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));

    // skipped CalendarEvent logged as failed with skipped_topicable_type message
    expect(
      logs.some(
        (l) =>
          l.values[1] === "thread" &&
          l.values[3] === "failed" &&
          String(l.values[4]).startsWith("skipped_topicable_type="),
      ),
    ).toBe(true);

    // success thread log with dataSource=dump
    const successLog = logs.find(
      (l) => l.values[1] === "thread" && l.values[3] === "success",
    );
    expect(successLog).toBeDefined();
    expect(successLog!.values[5]).toBe("dump");

    // comment log with dataSource=dump
    const commentLog = logs.find(
      (l) => l.values[1] === "comment" && l.values[3] === "success",
    );
    expect(commentLog).toBeDefined();
    expect(commentLog!.values[5]).toBe("dump");

    // import_map_threads inserted
    const threadMapInserts = calls.filter((c) =>
      c.sql.startsWith("insert into import_map_threads"),
    );
    expect(threadMapInserts).toHaveLength(1);
    expect(threadMapInserts[0].values).toEqual(["11", "thread-uuid"]);

    // import_map_comments inserted
    const commentMapInserts = calls.filter((c) =>
      c.sql.startsWith("insert into import_map_comments"),
    );
    expect(commentMapInserts).toHaveLength(1);
    expect(commentMapInserts[0].values).toEqual(["999", "comment-uuid"]);
  });

  it("calls createThread and createComment with correct repository signatures", async () => {
    const { q } = fakeQuery();
    const reader = stubReader();
    const { createThread, createComment } = await import("@/lib/repositories");
    (createThread as ReturnType<typeof vi.fn>).mockClear();
    (createComment as ReturnType<typeof vi.fn>).mockClear();

    await migrateThreadsAndComments({
      reader,
      q,
      jobId: "job-2",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      personMap: new Map([[1, "user-1"]]),
    });

    expect(createThread).toHaveBeenCalledTimes(1);
    const threadArgs = (createThread as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(threadArgs.projectId).toBe("proj-uuid");
    expect(threadArgs.title).toBe("subject-11");
    expect(threadArgs.bodyMarkdown).toBe("<p>hi</p>");
    expect(threadArgs.authorUserId).toBe("user-1");
    expect(threadArgs.sourceCreatedAt).toBeInstanceOf(Date);

    expect(createComment).toHaveBeenCalledTimes(1);
    const commentArgs = (createComment as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(commentArgs.projectId).toBe("proj-uuid");
    expect(commentArgs.threadId).toBe("thread-uuid");
    expect(commentArgs.bodyMarkdown).toBe("yo");
    expect(commentArgs.authorUserId).toBe("user-1");
  });

  it("re-uses existing import_map_threads row instead of recreating", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const q: Query = (async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.startsWith("select local_thread_id from import_map_threads")) {
        return { rows: [{ local_thread_id: "existing-thread" }] };
      }
      return { rows: [] };
    }) as Query;

    const { createThread } = await import("@/lib/repositories");
    (createThread as ReturnType<typeof vi.fn>).mockClear();

    const reader = stubReader();
    await migrateThreadsAndComments({
      reader,
      q,
      jobId: "job-3",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      personMap: new Map([[1, "user-1"]]),
    });

    expect(createThread).not.toHaveBeenCalled();
  });
});
