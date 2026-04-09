import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createToolDefinitions } from "../src/mcp/tools.js";

function createConfig(): AppConfig {
  return {
    accountId: "999999999",
    baseUrl: "https://basecamp.com/999999999/api/v1",
    userAgent: "Test Agent",
    auth: {
      mode: "basic",
      username: "user",
      password: "pass"
    },
    cacheTtlMs: 60_000,
    defaultLimit: 20,
    defaultHours: 24
  };
}

describe("MCP tools", () => {
  it("validates and returns starred project output", async () => {
    const service = {
      listStarredProjects: vi.fn(async () => [
        {
          id: 10,
          name: "Scoped",
          description: null,
          updatedAt: "2026-03-03T00:00:00Z",
          archived: false,
          color: "3185c5",
          url: "https://example.test/projects/10",
          appUrl: "https://example.test/app/projects/10"
        }
      ])
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const tool = tools.find((entry) => entry.name === "list_starred_projects");

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.parse({})).toEqual({});

    const result = await tool!.handler({});

    expect(result.isError).toBeUndefined();
    if (result.isError) {
      throw new Error("Expected success result.");
    }

    expect(tool!.outputSchema.parse(result.structuredContent)).toEqual({
      count: 1,
      projects: [
        {
          id: 10,
          name: "Scoped",
          description: null,
          updatedAt: "2026-03-03T00:00:00Z",
          archived: false,
          color: "3185c5",
          url: "https://example.test/projects/10",
          appUrl: "https://example.test/app/projects/10"
        }
      ]
    });
  });

  it("forwards filters to the activity tool and validates its schema", async () => {
    const service = {
      getRecentActivity: vi.fn(async () => [
        {
          id: 1,
          projectId: 10,
          projectName: "Scoped",
          entityId: 100,
          entityType: "Todo",
          action: "created",
          target: "Task",
          summary: "created Task",
          creatorId: 42,
          creatorName: "Matt",
          createdAt: "2026-03-03T00:00:00Z",
          updatedAt: "2026-03-03T00:00:00Z",
          url: "https://example.test/api/todos/1",
          appUrl: "https://example.test/app/todos/1"
        }
      ])
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const tool = tools.find((entry) => entry.name === "get_project_activity");
    const args = tool!.inputSchema.parse({
      projectId: 10,
      eventType: "Todo",
      hours: 6,
      limit: 5
    });

    expect(() => tool!.inputSchema.parse({ projectId: "10" })).toThrow();

    const result = await tool!.handler(args);

    expect(service.getRecentActivity).toHaveBeenCalledWith({
      projectId: 10,
      eventType: "Todo",
      hours: 6,
      limit: 5
    });
    if (result.isError) {
      throw new Error("Expected success result.");
    }
    expect(tool!.outputSchema.parse(result.structuredContent).count).toBe(1);
  });

  it("validates the messages, documents, and todos tools", async () => {
    const service = {
      getRecentMessages: vi.fn(async () => [
        {
          id: 1,
          messageId: 100,
          projectId: 10,
          projectName: "Scoped",
          subject: "Hello",
          excerpt: "World",
          attachments: 0,
          updatedAt: "2026-03-03T00:00:00Z",
          createdAt: "2026-03-03T00:00:00Z",
          lastUpdaterId: 42,
          lastUpdaterName: "Matt",
          url: "https://example.test/api/messages/100",
          appUrl: "https://example.test/app/messages/100"
        }
      ]),
      getRecentDocuments: vi.fn(async () => [
        {
          id: 2,
          projectId: 10,
          projectName: "Scoped",
          title: "Spec",
          private: false,
          updatedAt: "2026-03-03T00:00:00Z",
          createdAt: "2026-03-03T00:00:00Z",
          url: "https://example.test/api/documents/2",
          appUrl: "https://example.test/app/documents/2"
        }
      ]),
      getOpenTodos: vi.fn(async () => ({
        assigneeId: 42,
        todos: [
          {
            id: 3,
            projectId: 10,
            projectName: "Scoped",
            todolistId: 99,
            todolistName: "Launch",
            content: "Ship it",
            assigneeId: 42,
            assigneeName: "Matt",
            dueAt: null,
            completed: false,
            createdAt: "2026-03-03T00:00:00Z",
            updatedAt: "2026-03-03T00:00:00Z",
            url: "https://example.test/api/todos/3",
            appUrl: "https://example.test/app/todos/3"
          }
        ]
      }))
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const messagesTool = tools.find((entry) => entry.name === "get_project_messages")!;
    const documentsTool = tools.find((entry) => entry.name === "get_project_documents")!;
    const todosTool = tools.find((entry) => entry.name === "get_open_todos")!;

    const messagesResult = await messagesTool.handler({ hours: 12 });
    const documentsResult = await documentsTool.handler({ projectId: 10, limit: 3 });
    const todosResult = await todosTool.handler({ assigneeId: 42, projectId: 10 });

    if (messagesResult.isError || documentsResult.isError || todosResult.isError) {
      throw new Error("Expected success results.");
    }

    expect(messagesTool.outputSchema.parse(messagesResult.structuredContent).count).toBe(1);
    expect(documentsTool.outputSchema.parse(documentsResult.structuredContent).count).toBe(1);
    expect(todosTool.outputSchema.parse(todosResult.structuredContent).assigneeId).toBe(42);

    expect(service.getOpenTodos).toHaveBeenCalledWith({
      assigneeId: 42,
      projectId: 10
    });
  });

  it("validates list_project_members tool and forwards projectId", async () => {
    const service = {
      listProjectMembers: vi.fn(async () => [
        { id: 42, name: "Matt Antone", emailAddress: "matt@example.com" },
        { id: 99, name: "Steve Zweig", emailAddress: "steve@example.com" }
      ])
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const tool = tools.find((entry) => entry.name === "list_project_members")!;
    const args = tool.inputSchema.parse({ projectId: 10 });

    const result = await tool.handler(args);

    expect(service.listProjectMembers).toHaveBeenCalledWith(10);
    if (result.isError) {
      throw new Error("Expected success result.");
    }
    expect(tool.outputSchema.parse(result.structuredContent)).toMatchObject({
      count: 2,
      members: [
        { id: 42, name: "Matt Antone", emailAddress: "matt@example.com" },
        { id: 99, name: "Steve Zweig", emailAddress: "steve@example.com" }
      ]
    });
  });

  it("validates post_comment tool and forwards args to service", async () => {
    const service = {
      postComment: vi.fn(async () => ({
        id: 999,
        content: "Test comment",
        createdAt: "2026-03-03T12:00:00Z",
        appUrl: "https://basecamp.com/3440775/projects/10/messages/100#comment_999"
      }))
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const tool = tools.find((entry) => entry.name === "post_comment")!;
    const args = tool.inputSchema.parse({
      projectId: 10,
      messageId: 100,
      content: "Hello from AI"
    });

    const result = await tool.handler(args);

    expect(service.postComment).toHaveBeenCalledWith(10, 100, "Hello from AI", {
      subscribers: undefined,
      newSubscriberEmails: undefined,
      attachmentFilePaths: undefined
    });
    if (result.isError) {
      throw new Error("Expected success result.");
    }
    expect(tool.outputSchema.parse(result.structuredContent)).toMatchObject({
      id: 999,
      content: "Test comment",
      createdAt: "2026-03-03T12:00:00Z"
    });
  });

  it("forwards attachmentPaths to post_comment service as attachmentFilePaths", async () => {
    const service = {
      postComment: vi.fn(async () => ({
        id: 1000,
        content: "With file",
        createdAt: "2026-03-03T12:00:00Z",
        appUrl: "https://basecamp.com/3440775/projects/10/messages/100#comment_1000"
      }))
    } as any;

    const tools = createToolDefinitions(service, createConfig());
    const tool = tools.find((entry) => entry.name === "post_comment")!;
    const args = tool.inputSchema.parse({
      projectId: 10,
      messageId: 100,
      content: "See attachment",
      attachmentPaths: ["/tmp/doc.pdf"]
    });

    const result = await tool.handler(args);

    expect(service.postComment).toHaveBeenCalledWith(10, 100, "See attachment", {
      subscribers: undefined,
      newSubscriberEmails: undefined,
      attachmentFilePaths: ["/tmp/doc.pdf"]
    });
    if (result.isError) {
      throw new Error("Expected success result.");
    }
    expect(tool.outputSchema.parse(result.structuredContent).id).toBe(1000);
  });
});
