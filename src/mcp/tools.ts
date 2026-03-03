import * as z from "zod/v4";

import { BasecampApiError, ConfigurationError, ScopeError } from "../errors.js";
import type { AppConfig } from "../config.js";
import { BasecampService } from "../basecamp/service.js";
import {
  getOpenTodosInputSchema,
  getOpenTodosOutputSchema,
  getProjectActivityInputSchema,
  getProjectActivityOutputSchema,
  getProjectDocumentsInputSchema,
  getProjectDocumentsOutputSchema,
  getProjectMessagesInputSchema,
  getProjectMessagesOutputSchema,
  listStarredProjectsInputSchema,
  listStarredProjectsOutputSchema
} from "./schemas.js";

type ToolSuccess<T> = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
  isError?: false;
};

type ToolFailure = {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
};

type ToolResult<T> = Promise<ToolSuccess<T> | ToolFailure>;

type AnyToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodType<Record<string, unknown>>;
  handler: (args: any) => ToolResult<Record<string, unknown>>;
};

function createTextResult<T extends Record<string, unknown>>(data: T): ToolSuccess<T> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

function createErrorResult(error: unknown): ToolFailure {
  if (error instanceof ScopeError) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }]
    };
  }

  if (error instanceof ConfigurationError) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }]
    };
  }

  if (error instanceof BasecampApiError) {
    const details = error.retryAfterSeconds
      ? ` Retry after ${error.retryAfterSeconds} seconds.`
      : "";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Basecamp API error ${error.status}: ${error.message}${details}`
        }
      ]
    };
  }

  if (error instanceof Error) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }]
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: "Unknown tool error." }]
  };
}

export function createToolDefinitions(
  service: BasecampService,
  config: AppConfig
): AnyToolDefinition[] {
  return [
    {
      name: "list_starred_projects",
      title: "List Starred Projects",
      description:
        "List the authenticated user's starred Basecamp projects within the configured scope.",
      inputSchema: listStarredProjectsInputSchema,
      outputSchema: listStarredProjectsOutputSchema,
      handler: async () => {
        try {
          const projects = await service.listStarredProjects();
          return createTextResult({
            count: projects.length,
            projects
          });
        } catch (error) {
          return createErrorResult(error);
        }
      }
    },
    {
      name: "get_project_activity",
      title: "Get Project Activity",
      description:
        "Get recent Basecamp activity for one starred project or across all starred projects.",
      inputSchema: getProjectActivityInputSchema,
      outputSchema: getProjectActivityOutputSchema,
      handler: async (args: z.output<typeof getProjectActivityInputSchema>) => {
        try {
          const activities = await service.getRecentActivity(args);
          const since =
            args.since ??
            new Date(
              Date.now() - (args.hours ?? config.defaultHours) * 60 * 60 * 1_000
            ).toISOString();

          return createTextResult({
            count: activities.length,
            since,
            activities
          });
        } catch (error) {
          return createErrorResult(error);
        }
      }
    },
    {
      name: "get_project_messages",
      title: "Get Project Messages",
      description:
        "Get recent message topics from one starred project or across all starred projects.",
      inputSchema: getProjectMessagesInputSchema,
      outputSchema: getProjectMessagesOutputSchema,
      handler: async (args: z.output<typeof getProjectMessagesInputSchema>) => {
        try {
          const messages = await service.getRecentMessages(args);
          const since =
            args.since ??
            new Date(
              Date.now() - (args.hours ?? config.defaultHours) * 60 * 60 * 1_000
            ).toISOString();

          return createTextResult({
            count: messages.length,
            since,
            messages
          });
        } catch (error) {
          return createErrorResult(error);
        }
      }
    },
    {
      name: "get_project_documents",
      title: "Get Project Documents",
      description:
        "Get recent documents from one starred project or across all starred projects.",
      inputSchema: getProjectDocumentsInputSchema,
      outputSchema: getProjectDocumentsOutputSchema,
      handler: async (args: z.output<typeof getProjectDocumentsInputSchema>) => {
        try {
          const documents = await service.getRecentDocuments(args);
          const since =
            args.since ??
            new Date(
              Date.now() - (args.hours ?? config.defaultHours) * 60 * 60 * 1_000
            ).toISOString();

          return createTextResult({
            count: documents.length,
            since,
            documents
          });
        } catch (error) {
          return createErrorResult(error);
        }
      }
    },
    {
      name: "get_open_todos",
      title: "Get Open Todos",
      description:
        "Get open assigned todos across starred projects, defaulting to the authenticated user.",
      inputSchema: getOpenTodosInputSchema,
      outputSchema: getOpenTodosOutputSchema,
      handler: async (args: z.output<typeof getOpenTodosInputSchema>) => {
        try {
          const result = await service.getOpenTodos(args);
          return createTextResult({
            assigneeId: result.assigneeId,
            count: result.todos.length,
            todos: result.todos
          });
        } catch (error) {
          return createErrorResult(error);
        }
      }
    }
  ];
}
