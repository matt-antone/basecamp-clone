import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = existsSync(process.execPath) ? process.execPath : "node";
const tsxCliPath = path.join(repoRoot, "node_modules/tsx/dist/cli.mjs");

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    })
  );
}

function createStdioTransport(baseUrl: string): StdioClientTransport {
  if (!existsSync(tsxCliPath)) {
    throw new Error(`tsx CLI not found at ${tsxCliPath}`);
  }

  return new StdioClientTransport({
    command: nodeCommand,
    args: [tsxCliPath, "src/index.ts"],
    cwd: repoRoot,
    stderr: "pipe",
    env: {
      ...inheritedEnv(),
      BASECAMP_ACCOUNT_ID: "999999999",
      BASECAMP_BASE_URL: baseUrl,
      BASECAMP_AUTH_MODE: "basic",
      BASECAMP_USERNAME: "user",
      BASECAMP_PASSWORD: "pass",
      BASECAMP_USER_AGENT: "Test Agent"
    }
  });
}

async function startMockBasecampServer(): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    response.setHeader("content-type", "application/json");

    if (url.pathname.endsWith("/stars.json")) {
      response.end(
        JSON.stringify([
          {
            project_id: 10,
            created_at: "2026-03-03T00:00:00Z",
            url: "http://localhost/star",
            app_url: "http://localhost/app/star"
          }
        ])
      );
      return;
    }

    if (url.pathname.endsWith("/projects.json")) {
      response.end(
        JSON.stringify([
          {
            id: 10,
            name: "Scoped",
            description: null,
            updated_at: "2026-03-03T00:00:00Z",
            url: "http://localhost/projects/10",
            app_url: "http://localhost/app/projects/10",
            template: false,
            archived: false,
            starred: true,
            trashed: false,
            draft: false,
            is_client_project: false,
            color: "3185c5"
          }
        ])
      );
      return;
    }

    if (url.pathname.endsWith("/people/me.json")) {
      response.end(
        JSON.stringify({
          id: 42,
          name: "Matt",
          email_address: "matt@example.com"
        })
      );
      return;
    }

    if (url.pathname.endsWith("/attachments.json") && request.method === "POST") {
      response.statusCode = 200;
      response.end(JSON.stringify({ token: "e2e-attachment-token" }));
      return;
    }

    if (
      url.pathname.endsWith("/projects/10/messages/100/comments.json") &&
      request.method === "POST"
    ) {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          id: 888,
          content: "E2E comment with attachment",
          created_at: "2026-03-03T12:00:00Z",
          topic_url: "https://basecamp.com/999999999/api/v1/messages/100.json"
        })
      );
      return;
    }

    if (url.pathname.endsWith("/people/42/assigned_todos.json")) {
      response.end(
        JSON.stringify([
          {
            id: 99,
            name: "Launch",
            description: null,
            created_at: "2026-03-03T00:00:00Z",
            updated_at: "2026-03-03T00:00:00Z",
            url: "http://localhost/todolists/99",
            app_url: "http://localhost/app/todolists/99",
            completed: false,
            position: 1,
            private: false,
            trashed: false,
            completed_count: 0,
            remaining_count: 1,
            bucket: {
              id: 10,
              name: "Scoped",
              type: "Project",
              url: "",
              app_url: ""
            },
            assigned_todos: [
              {
                id: 3,
                todolist_id: 99,
                position: 1,
                content: "Ship it",
                due_at: null,
                due_on: null,
                created_at: "2026-03-03T00:00:00Z",
                updated_at: "2026-03-03T00:00:00Z",
                completed_at: false,
                comments_count: 0,
                private: false,
                trashed: false,
                completed: false,
                url: "http://localhost/todos/3",
                app_url: "http://localhost/app/todos/3",
                assignee: {
                  id: 42,
                  type: "Person",
                  name: "Matt"
                }
              }
            ]
          }
        ])
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to get mock server address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/999999999/api/v1`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

describe("stdio MCP server", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("serves tools over stdio against mocked Basecamp responses", async () => {
    const mockBasecamp = await startMockBasecampServer();
    const transport = createStdioTransport(mockBasecamp.url);
    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });

    cleanup = async () => {
      await client.close();
      await transport.close();
      await mockBasecamp.close();
    };

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_starred_projects",
        "get_project_activity",
        "get_project_messages",
        "get_project_documents",
        "get_open_todos",
        "list_project_members",
        "post_comment"
      ])
    );

    const projectsResult = await client.callTool({
      name: "list_starred_projects",
      arguments: {}
    });
    const todosResult = await client.callTool({
      name: "get_open_todos",
      arguments: {}
    });

    expect(projectsResult.structuredContent).toMatchObject({
      count: 1
    });
    expect(todosResult.structuredContent).toMatchObject({
      assigneeId: 42,
      count: 1
    });
  });

  it("post_comment with attachmentPaths uploads file and creates comment", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-attach-"));
    const filePath = path.join(dir, "e2e-file.txt");
    writeFileSync(filePath, "e2e attachment content");

    const mockBasecamp = await startMockBasecampServer();
    const transport = createStdioTransport(mockBasecamp.url);
    const client = new Client({
      name: "test-client",
      version: "1.0.0"
    });

    cleanup = async () => {
      await client.close();
      await transport.close();
      await mockBasecamp.close();
    };

    await client.connect(transport);

    const result = await client.callTool({
      name: "post_comment",
      arguments: {
        projectId: 10,
        messageId: 100,
        content: "E2E comment with attachment",
        attachmentPaths: [filePath]
      }
    });

    expect(result.isError).toBeFalsy();
    if (result.structuredContent && typeof result.structuredContent === "object") {
      const content = result.structuredContent as { id?: number; content?: string };
      expect(content.id).toBe(888);
      expect(content.content).toBe("E2E comment with attachment");
    }
  });
});
