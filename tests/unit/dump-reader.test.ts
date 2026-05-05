import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { Bc2Client } from "@/lib/imports/bc2-client";
import { createDumpReader } from "@/lib/imports/dump-reader";

async function makeDump(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dump-"));
}

function stubClient(getImpl: (p: string) => Promise<unknown>): Bc2Client {
  return {
    get: vi.fn(async (p: string) => ({ body: await getImpl(p), nextUrl: null })),
  } as unknown as Bc2Client;
}

describe("DumpReader", () => {
  let dumpDir: string;
  beforeEach(async () => {
    dumpDir = await makeDump();
  });

  it("returns dump source when JSON file exists", async () => {
    await fs.writeFile(path.join(dumpDir, "people.json"), JSON.stringify([{ id: 1 }]));
    const reader = createDumpReader({
      dumpDir,
      client: stubClient(async () => {
        throw new Error("api should not be called");
      }),
      errors: new Set(),
    });
    const out = await reader.people();
    expect(out.source).toBe("dump");
    expect(out.body).toEqual([{ id: 1 }]);
  });

  it("falls back to API when JSON file missing", async () => {
    const client = stubClient(async () => [{ id: 99 }]);
    const reader = createDumpReader({ dumpDir, client, errors: new Set() });
    const out = await reader.people();
    expect(out.source).toBe("api");
    expect(out.body).toEqual([{ id: 99 }]);
  });

  it("falls back to API when path is in errors set", async () => {
    const projectsDir = path.join(dumpDir, "projects");
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.writeFile(path.join(projectsDir, "active.json"), JSON.stringify([{ id: 1 }]));
    const errors = new Set(["projects/active.json"]);
    const client = stubClient(async () => [{ id: 2 }]);
    const reader = createDumpReader({ dumpDir, client, errors });
    const out = await reader.activeProjects();
    expect(out.source).toBe("api");
    expect(out.body).toEqual([{ id: 2 }]);
  });

  it("topicDetail reads dump for known type, falls back to API when file missing", async () => {
    const dir = path.join(dumpDir, "by-project", "10", "messages");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "55.json"), JSON.stringify({ id: 55 }));
    const reader = createDumpReader({
      dumpDir,
      client: stubClient(async () => null),
      errors: new Set(),
    });
    const hit = await reader.topicDetail(10, "Message", 55);
    expect(hit.source).toBe("dump");
    expect(hit.body).toEqual({ id: 55 });
    const miss = await reader.topicDetail(10, "Message", 999);
    expect(miss.source).toBe("api");
    expect(miss.body).toBeNull();
  });
});
