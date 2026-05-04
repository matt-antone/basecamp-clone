// lib/imports/bc2-fetcher.ts
import { Bc2Client, Bc2Response } from "./bc2-client";

// Raw BC2 API shapes — only the fields we use
export interface Bc2Person {
  id: number;
  name: string;
  email_address: string;
  avatar_url: string | null;
  title: string | null;
  time_zone: string | null;
}

export interface Bc2Project {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

interface Bc2Comment {
  id: number;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
  attachments?: Bc2Attachment[];
}

/** BC2 attachment container (message, comment, upload, etc.). See bcx-api attachments.md */
export interface Bc2Attachable {
  id: number;
  type: string;
  url?: string;
  app_url?: string;
}

// Individual message response from GET /projects/{id}/messages/{id}.json
// Comments are embedded — there is no separate list endpoint for them.
interface Bc2Message {
  id: number;
  subject: string;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
  /** Message-level attachments (same shape as `/projects/{id}/attachments.json`). */
  attachments?: Bc2Attachment[];
  comments: Bc2Comment[];
}

// Topic summary from GET /projects/{id}/topics.json
interface Bc2Topic {
  id: number;
  topicable: {
    id: number;
    type: string; // "Message", "Document", "TodoList", etc.
    url: string;
  };
}

export interface Bc2Attachment {
  id: number;
  name: string;
  content_type: string;
  byte_size: number;
  url: string;
  created_at: string;
  creator: { id: number; name: string };
  /** Present on attachment list/detail — used to link files to threads/comments. */
  attachable?: Bc2Attachable;
}

/** Which BC2 project lists to paginate (`/projects.json` vs `/projects/archived.json`). */
export type Bc2ProjectSource = "active" | "archived" | "all";

/** Parse Basecamp 2 API ISO timestamps for Postgres `timestamptz` columns. */
export function parseBc2IsoTimestamptz(iso: string | null | undefined): Date | null {
  if (iso == null || String(iso).trim() === "") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class Bc2Fetcher {
  constructor(private client: Bc2Client) {}

  async *fetchPeople(): AsyncGenerator<Bc2Person> {
    yield* this.paginate<Bc2Person>("/people.json");
  }

  /**
   * Yields BC2 projects from the Basecamp 2 API.
   * - `active` (default): `/projects.json` only
   * - `archived`: `/projects/archived.json` only
   * - `all`: active first, then archived (full account)
   */
  async *fetchProjects(options?: { source?: Bc2ProjectSource }): AsyncGenerator<Bc2Project> {
    const source = options?.source ?? "active";
    if (source === "active" || source === "all") {
      yield* this.paginate<Bc2Project>("/projects.json");
    }
    if (source === "archived" || source === "all") {
      yield* this.paginate<Bc2Project>("/projects/archived.json");
    }
  }

  // BC2 has no list endpoint for messages. Topics lists all topic types;
  // we filter for Message and fetch each individually to get content + comments.
  async *fetchMessages(projectId: string): AsyncGenerator<Bc2Message> {
    for await (const topic of this.paginate<Bc2Topic>(`/projects/${projectId}/topics.json`)) {
      if (topic.topicable.type !== "Message") continue;
      const { body } = await this.client.get<Bc2Message>(
        `/projects/${projectId}/messages/${topic.topicable.id}.json`
      );
      yield body;
    }
  }

  async *fetchAttachments(projectId: string): AsyncGenerator<Bc2Attachment> {
    yield* this.paginate<Bc2Attachment>(`/projects/${projectId}/attachments.json`);
  }

  private async *paginate<T>(path: string): AsyncGenerator<T> {
    let nextUrl: string | null = path;
    while (nextUrl !== null) {
      const response: Bc2Response<T[]> = await this.client.get<T[]>(nextUrl);
      for (const item of response.body) {
        yield item;
      }
      nextUrl = response.nextUrl;
    }
  }
}
