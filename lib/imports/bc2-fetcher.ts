// lib/imports/bc2-fetcher.ts
import { Bc2Client } from "./bc2-client";

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

export interface Bc2Comment {
  id: number;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
  attachments?: Bc2Attachment[];
}

// Individual message response from GET /projects/{id}/messages/{id}.json
// Comments are embedded — there is no separate list endpoint for them.
export interface Bc2Message {
  id: number;
  subject: string;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
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
}

export class Bc2Fetcher {
  constructor(private client: Bc2Client) {}

  async *fetchPeople(): AsyncGenerator<Bc2Person> {
    yield* this.paginate<Bc2Person>("/people.json");
  }

  async *fetchProjects(): AsyncGenerator<Bc2Project> {
    yield* this.paginate<Bc2Project>("/projects.json");
    yield* this.paginate<Bc2Project>("/projects/archived.json");
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
      const response = await this.client.get<T[]>(nextUrl);
      for (const item of response.body) {
        yield item;
      }
      nextUrl = response.nextUrl;
    }
  }
}
