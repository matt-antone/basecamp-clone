import { readFile } from "fs/promises";
import path from "path";

import type { AppConfig } from "../config.js";
import { TtlCache } from "../cache/ttl-cache.js";
import { ScopeError } from "../errors.js";
import { BasecampClient } from "./client.js";
import { getContentTypeFromFilename } from "./mime.js";
import {
  normalizeActivity,
  normalizeDocument,
  normalizeMessage,
  normalizeProject,
  normalizeProjectMember,
  normalizeTodo
} from "./normalize.js";
import type {
  ActivityRecord,
  BasecampAccess,
  BasecampAssignedTodoList,
  BasecampDocument,
  BasecampEvent,
  BasecampPerson,
  BasecampProject,
  BasecampStar,
  BasecampTopic,
  DocumentRecord,
  MessageRecord,
  ProjectMemberRecord,
  ProjectSummary,
  TodoRecord
} from "./types.js";

export type QueryWindow = {
  since?: string;
  hours?: number;
  limit?: number;
};

export type ActivityQuery = QueryWindow & {
  projectId?: number;
  eventType?: string;
};

export type ContentQuery = QueryWindow & {
  projectId?: number;
};

export type TodoQuery = {
  projectId?: number;
  assigneeId?: number;
  dueSince?: string;
  limit?: number;
};

export class BasecampService {
  constructor(
    private readonly client: BasecampClient,
    private readonly config: AppConfig,
    private readonly cache: TtlCache = new TtlCache()
  ) {}

  async listStarredProjects(): Promise<ProjectSummary[]> {
    return this.cache.getOrSet("starred-projects", this.config.cacheTtlMs, async () => {
      const stars = await this.client.getJson<BasecampStar[]>("/stars");
      const projects = await this.client.getJson<BasecampProject[]>("/projects");
      const starIds = new Set(stars.map((star) => star.project_id));

      return projects
        .filter((project) => starIds.has(project.id))
        .filter((project) =>
          this.config.allowedProjectIds
            ? this.config.allowedProjectIds.has(project.id)
            : true
        )
        .map(normalizeProject)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async getCurrentPerson(): Promise<BasecampPerson> {
    return this.cache.getOrSet("current-person", this.config.cacheTtlMs, () =>
      this.client.getJson<BasecampPerson>("/people/me")
    );
  }

  async getRecentActivity(query: ActivityQuery = {}): Promise<ActivityRecord[]> {
    const projectMap = await this.getProjectMap();
    const scopeProject = query.projectId
      ? this.requireProject(projectMap, query.projectId)
      : undefined;
    const since = this.resolveSince(query);
    const limit = query.limit ?? this.config.defaultLimit;
    const filterType = query.eventType?.trim().toLowerCase();
    const cacheKey = `activity:${scopeProject?.id ?? "all"}:${since}:${filterType ?? ""}:${limit}`;

    return this.cache.getOrSet(cacheKey, this.config.cacheTtlMs, async () => {
      return this.collectPages<BasecampEvent, ActivityRecord>(
        scopeProject ? `/projects/${scopeProject.id}/events` : "/events",
        {
          since
        },
        limit,
        (event) => {
          const project = scopeProject ?? this.projectFromBucket(projectMap, event.bucket);

          if (!project) {
            return null;
          }

          const normalized = normalizeActivity(event, project);

          if (
            filterType &&
            normalized.entityType.toLowerCase() !== filterType &&
            normalized.action.toLowerCase() !== filterType
          ) {
            return null;
          }

          return normalized;
        }
      );
    });
  }

  async getRecentMessages(query: ContentQuery = {}): Promise<MessageRecord[]> {
    const projectMap = await this.getProjectMap();
    const scopeProject = query.projectId
      ? this.requireProject(projectMap, query.projectId)
      : undefined;
    const since = this.resolveSince(query);
    const limit = query.limit ?? this.config.defaultLimit;
    const cacheKey = `messages:${scopeProject?.id ?? "all"}:${since}:${limit}`;

    return this.cache.getOrSet(cacheKey, this.config.cacheTtlMs, async () => {
      return this.collectPages<BasecampTopic, MessageRecord>(
        scopeProject ? `/projects/${scopeProject.id}/topics` : "/topics",
        {
          sort: "newest"
        },
        limit,
        (topic) => {
          if (topic.topicable.type !== "Message") {
            return null;
          }

          const project = scopeProject ?? this.projectFromBucket(projectMap, topic.bucket);

          if (!project || new Date(topic.updated_at).getTime() < new Date(since).getTime()) {
            return null;
          }

          return normalizeMessage(topic, project);
        }
      );
    });
  }

  async getRecentDocuments(query: ContentQuery = {}): Promise<DocumentRecord[]> {
    const projectMap = await this.getProjectMap();
    const scopeProject = query.projectId
      ? this.requireProject(projectMap, query.projectId)
      : undefined;
    const since = this.resolveSince(query);
    const limit = query.limit ?? this.config.defaultLimit;
    const cacheKey = `documents:${scopeProject?.id ?? "all"}:${since}:${limit}`;

    return this.cache.getOrSet(cacheKey, this.config.cacheTtlMs, async () => {
      return this.collectPages<BasecampDocument, DocumentRecord>(
        scopeProject ? `/projects/${scopeProject.id}/documents` : "/documents",
        {
          sort: "newest"
        },
        limit,
        (document) => {
          const project = scopeProject ?? this.projectFromBucket(projectMap, document.bucket);

          if (!project || new Date(document.updated_at).getTime() < new Date(since).getTime()) {
            return null;
          }

          return normalizeDocument(document, project);
        }
      );
    });
  }

  async listProjectMembers(projectId: number): Promise<ProjectMemberRecord[]> {
    const projectMap = await this.getProjectMap();
    this.requireProject(projectMap, projectId);

    const members: ProjectMemberRecord[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await this.client.getCollectionPage<BasecampAccess>(
        `/projects/${projectId}/accesses`,
        page
      );
      for (const access of batch) {
        if (!access.trashed) {
          members.push(normalizeProjectMember(access));
        }
      }
      if (batch.length < 50) {
        break;
      }
    }
    return members;
  }

  async uploadAttachment(filePath: string): Promise<{ token: string; name: string }> {
    const baseDir =
      process.env.BASECAMP_ATTACHMENTS_CWD?.trim() || process.cwd();
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(baseDir, filePath);
    let buffer: Buffer;
    try {
      buffer = await readFile(resolvedPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Attachment file not readable: ${filePath}. ${message}`);
    }
    const basename = path.basename(resolvedPath);
    const rawName = basename.includes(".") ? basename : `${basename}.bin`;
    const name = rawName.replace(/\s+/g, "_");
    const contentType = getContentTypeFromFilename(rawName);
    const result = await this.client.createAttachment(buffer, contentType);
    const token = result?.token;
    if (!token || typeof token !== "string") {
      throw new Error(
        "Attachment upload did not return a token. Basecamp may have rejected the file."
      );
    }
    return { token, name };
  }

  async postComment(
    projectId: number,
    messageId: number,
    content: string,
    options?: {
      subscribers?: number[];
      newSubscriberEmails?: string[];
      attachmentFilePaths?: string[];
    }
  ): Promise<{
    id: number;
    content: string;
    createdAt: string;
    appUrl: string;
  }> {
    const projectMap = await this.getProjectMap();
    this.requireProject(projectMap, projectId);

    const path = `/projects/${projectId}/messages/${messageId}/comments`;
    const body: Record<string, unknown> = { content };

    let attachments: Array<{ token: string; name: string }> = [];
    if (options?.attachmentFilePaths?.length) {
      for (const filePath of options.attachmentFilePaths) {
        const att = await this.uploadAttachment(filePath);
        attachments.push(att);
      }
      body.attachments = attachments;
    }

    if (options?.subscribers?.length) {
      body.subscribers = options.subscribers;
    }
    if (options?.newSubscriberEmails?.length) {
      body.new_subscriber_emails = options.newSubscriberEmails;
    }

    const raw = await this.client.postJson<{
      id: number;
      content: string;
      created_at: string;
      topic_url: string;
    }>(path, body);

    const appUrl =
      raw.topic_url.replace(/\.json$/i, "").replace("/api/v1", "") +
      `#comment_${raw.id}`;
    return {
      id: raw.id,
      content: raw.content,
      createdAt: raw.created_at,
      appUrl
    };
  }

  async getOpenTodos(query: TodoQuery = {}): Promise<{
    assigneeId: number;
    todos: TodoRecord[];
  }> {
    const projectMap = await this.getProjectMap();
    const scopeProject = query.projectId
      ? this.requireProject(projectMap, query.projectId)
      : undefined;
    const assigneeId = query.assigneeId ?? (await this.getCurrentPerson()).id;
    const limit = query.limit ?? this.config.defaultLimit;
    const cacheKey = `open-todos:${assigneeId}:${scopeProject?.id ?? "all"}:${query.dueSince ?? ""}:${limit}`;

    const todos = await this.cache.getOrSet(cacheKey, this.config.cacheTtlMs, async () => {
      const todolists = await this.client.getJson<BasecampAssignedTodoList[]>(
        `/people/${assigneeId}/assigned_todos`,
        {
          searchParams: {
            due_since: query.dueSince
          }
        }
      );

      const results: TodoRecord[] = [];

      for (const todolist of todolists) {
        const project = scopeProject ?? this.projectFromBucket(projectMap, todolist.bucket);

        if (!project) {
          continue;
        }

        for (const todo of todolist.assigned_todos) {
          results.push(normalizeTodo(todolist, todo, project));

          if (results.length >= limit) {
            return results;
          }
        }
      }

      return results;
    });

    return {
      assigneeId,
      todos
    };
  }

  private async getProjectMap(): Promise<Map<number, ProjectSummary>> {
    const projects = await this.listStarredProjects();
    return new Map(projects.map((project) => [project.id, project]));
  }

  private requireProject(
    projects: Map<number, ProjectSummary>,
    projectId: number
  ): ProjectSummary {
    const project = projects.get(projectId);

    if (!project) {
      throw new ScopeError(
        `Project ${projectId} is not in the starred project scope.`
      );
    }

    return project;
  }

  private projectFromBucket(
    projects: Map<number, ProjectSummary>,
    bucket: { id: number; type: string } | undefined
  ): ProjectSummary | undefined {
    if (!bucket || bucket.type !== "Project") {
      return undefined;
    }

    return projects.get(bucket.id);
  }

  private resolveSince(query: QueryWindow): string {
    if (query.since) {
      return new Date(query.since).toISOString();
    }

    const hours = query.hours ?? this.config.defaultHours;
    const since = new Date(Date.now() - hours * 60 * 60 * 1_000);
    return since.toISOString();
  }

  private async collectPages<TRaw, TNormalized>(
    path: string,
    searchParams: Record<string, string | number | undefined>,
    limit: number,
    mapRecord: (record: TRaw) => TNormalized | null
  ): Promise<TNormalized[]> {
    const normalized: TNormalized[] = [];

    for (let page = 1; page <= 10 && normalized.length < limit; page += 1) {
      const records = await this.client.getCollectionPage<TRaw>(path, page, {
        searchParams
      });

      if (records.length === 0) {
        break;
      }

      for (const record of records) {
        const mapped = mapRecord(record);

        if (mapped) {
          normalized.push(mapped);
        }

        if (normalized.length >= limit) {
          break;
        }
      }

      if (records.length < 50) {
        break;
      }
    }

    return normalized;
  }
}
