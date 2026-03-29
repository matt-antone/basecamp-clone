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

export interface Bc2Message {
  id: number;
  subject: string;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
}

export interface Bc2Comment {
  id: number;
  content: string;
  created_at: string;
  creator: { id: number; name: string };
  attachments?: Bc2Attachment[];
}

export interface Bc2Attachment {
  id: number;
  filename: string;
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

  async *fetchMessages(projectId: string): AsyncGenerator<Bc2Message> {
    yield* this.paginate<Bc2Message>(`/projects/${projectId}/messages.json`);
  }

  async *fetchComments(projectId: string, messageId: string): AsyncGenerator<Bc2Comment> {
    yield* this.paginate<Bc2Comment>(
      `/projects/${projectId}/messages/${messageId}/comments.json`
    );
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
