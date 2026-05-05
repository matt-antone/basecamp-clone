import { promises as fs } from "fs";
import * as path from "path";
import { Bc2Client } from "./bc2-client";

export interface DumpSource<T = unknown> {
  source: "dump" | "api";
  body: T;
}

export const TOPICABLE_TO_SEGMENT: Record<string, string> = {
  Message: "messages",
  Todolist: "todolists",
  CalendarEvent: "calendar_events",
  Calendar: "calendar_events",
  Upload: "uploads",
  Document: "documents",
};

export interface DumpReader {
  people(): Promise<DumpSource>;
  activeProjects(): Promise<DumpSource>;
  archivedProjects(): Promise<DumpSource>;
  topics(projectId: number): Promise<DumpSource>;
  topicDetail(projectId: number, topicableType: string, topicableId: number): Promise<DumpSource>;
  attachments(projectId: number): Promise<DumpSource>;
}

export interface DumpReaderOptions {
  dumpDir: string;
  client: Bc2Client;
  errors: Set<string>;
}

async function readIfExists(absPath: string): Promise<unknown | null> {
  try {
    const buf = await fs.readFile(absPath, "utf8");
    if (buf.trim().length === 0) return null;
    return JSON.parse(buf);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function fetchPaginated(client: Bc2Client, firstPath: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let next: string | null = firstPath;
  while (next) {
    const res = await client.get<unknown[]>(next);
    if (Array.isArray(res.body)) out.push(...res.body);
    next = res.nextUrl;
  }
  return out;
}

export function createDumpReader(opts: DumpReaderOptions): DumpReader {
  const { dumpDir, client, errors } = opts;

  async function tryDump(relPath: string, fallback: () => Promise<unknown>): Promise<DumpSource> {
    if (errors.has(relPath)) {
      return { source: "api", body: await fallback() };
    }
    const body = await readIfExists(path.join(dumpDir, relPath));
    if (body !== null) return { source: "dump", body };
    return { source: "api", body: await fallback() };
  }

  return {
    people() {
      return tryDump("people.json", () => fetchPaginated(client, "/people.json"));
    },
    activeProjects() {
      return tryDump("projects/active.json", () =>
        fetchPaginated(client, "/projects.json"),
      );
    },
    archivedProjects() {
      return tryDump("projects/archived.json", () =>
        fetchPaginated(client, "/projects/archived.json"),
      );
    },
    topics(projectId) {
      const rel = `by-project/${projectId}/topics.json`;
      return tryDump(rel, () =>
        fetchPaginated(client, `/projects/${projectId}/topics.json`),
      );
    },
    topicDetail(projectId, topicableType, topicableId) {
      const segment = TOPICABLE_TO_SEGMENT[topicableType];
      if (!segment) {
        return Promise.resolve({ source: "api" as const, body: null });
      }
      const rel = `by-project/${projectId}/${segment}/${topicableId}.json`;
      return tryDump(rel, async () => {
        const res = await client.get(`/projects/${projectId}/${segment}/${topicableId}.json`);
        return res.body;
      });
    },
    attachments(projectId) {
      const rel = `by-project/${projectId}/attachments.json`;
      return tryDump(rel, () =>
        fetchPaginated(client, `/projects/${projectId}/attachments.json`),
      );
    },
  };
}
