// supabase/functions/basecamp-mcp/tools.ts
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentIdentity } from "./auth.ts";
import * as db from "./db.ts";
import { marked } from "marked";
import { PROJECT_STATUSES_ZOD } from "../../../lib/project-status.ts";

interface ToolServer {
  tool<S extends Record<string, z.ZodTypeAny>>(
    name: string,
    description: string,
    shape: S,
    handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>
  ): void;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function notFound(id: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: `Not found: ${id}` }] };
}

function dbError(e: unknown) {
  return { isError: true as const, content: [{ type: "text" as const, text: "Database error" }] };
}

async function toHtml(markdown: string): Promise<string> {
  return await marked(markdown);
}

export function registerTools(
  server: ToolServer,
  supabase: SupabaseClient,
  agent: AgentIdentity
): void {

  // ─── Read ─────────────────────────────────────────────────────────────────

  server.tool(
    "list_projects",
    "List all non-archived projects with name, slug, description, deadline, status, and client name.",
    {},
    async () => {
      try {
        return ok(await db.listProjects(supabase));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "get_project",
    "Get full project detail: metadata, last 10 threads with comment counts, total file count, and client info.",
    { project_id: z.string().uuid() },
    async ({ project_id }) => {
      try {
        const result = await db.getProject(supabase, project_id);
        if (!result) return notFound(project_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "get_thread",
    "Get a full thread with title, body, all comments in order, and files attached to the thread or its comments.",
    { thread_id: z.string().uuid() },
    async ({ thread_id }) => {
      try {
        const result = await db.getThread(supabase, thread_id);
        if (!result) return notFound(thread_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "list_files",
    "List files for a project. Pass thread_id to filter to files attached to a specific thread.",
    { project_id: z.string().uuid(), thread_id: z.string().uuid().optional() },
    async ({ project_id, thread_id }) => {
      try {
        return ok(await db.listFiles(supabase, project_id, thread_id));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "get_file",
    "Get full metadata for a single file including dropbox_path, checksum, and thread/comment attachment.",
    { file_id: z.string().uuid() },
    async ({ file_id }) => {
      try {
        const result = await db.getFile(supabase, file_id);
        if (!result) return notFound(file_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "search_content",
    "Full-text search across discussion threads and comments. Optionally scope to a project. limit defaults to 20, max 100.",
    {
      query: z.string().min(1),
      project_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, project_id, limit }) => {
      try {
        return ok(await db.searchContent(supabase, query, project_id, limit));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  // ─── Write ──────────────────────────────────────────────────────────────

  server.tool(
    "create_project",
    "Create a new project. business_client_id is the UUID of a row in the clients table.",
    {
      name: z.string().min(1),
      description: z.string().nullish(),
      deadline: z.string().date().nullish(),
      business_client_id: z.string().uuid().nullish(),
      tags: z.array(z.string()).nullish(),
      requestor: z.string().nullish(),
      pm_note: z.string().nullish(),
    },
    async (params) => {
      try {
        return ok(await db.createProject(supabase, params, agent.client_id));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_project",
    "Update mutable project fields. Only provided fields are changed. status must be one of: new, in_progress, blocked, complete, billing.",
    {
      project_id: z.string().uuid(),
      name: z.string().min(1).nullish(),
      description: z.string().nullish(),
      deadline: z.string().date().nullish(),
      status: z.enum(PROJECT_STATUSES_ZOD).nullish(),
      archived: z.boolean().nullish(),
      tags: z.array(z.string()).nullish(),
      requestor: z.string().nullish(),
      pm_note: z.string().nullish(),
    },
    async ({ project_id, ...params }) => {
      try {
        const result = await db.updateProject(supabase, project_id, params);
        if (!result) return notFound(project_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "create_thread",
    "Create a discussion thread in a project. body_markdown is converted to HTML automatically.",
    {
      project_id: z.string().uuid(),
      title: z.string().min(1),
      body_markdown: z.string().min(1),
    },
    async ({ project_id, title, body_markdown }) => {
      try {
        const body_html = await toHtml(body_markdown);
        return ok(await db.createThread(supabase, { project_id, title, body_markdown, body_html }, agent.client_id));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_thread",
    "Update a thread's title and/or body. Body markdown is re-converted to HTML.",
    {
      thread_id: z.string().uuid(),
      title: z.string().min(1).optional(),
      body_markdown: z.string().min(1).optional(),
    },
    async ({ thread_id, title, body_markdown }) => {
      try {
        const patch: Record<string, string | undefined> = { title };
        if (body_markdown) {
          patch.body_markdown = body_markdown;
          patch.body_html = await toHtml(body_markdown);
        }
        const result = await db.updateThread(supabase, thread_id, patch);
        if (!result) return notFound(thread_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "create_comment",
    "Add a comment to a thread. body_markdown is converted to HTML automatically.",
    {
      thread_id: z.string().uuid(),
      body_markdown: z.string().min(1),
    },
    async ({ thread_id, body_markdown }) => {
      try {
        const thread = await db.getThread(supabase, thread_id);
        if (!thread) return notFound(thread_id);
        const body_html = await toHtml(body_markdown);
        return ok(await db.createComment(
          supabase,
          { thread_id, body_markdown, body_html, project_id: thread.thread.project_id },
          agent.client_id
        ));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_comment",
    "Edit a comment's body. Sets edited_at to current timestamp. body_markdown is re-converted to HTML.",
    {
      comment_id: z.string().uuid(),
      body_markdown: z.string().min(1),
    },
    async ({ comment_id, body_markdown }) => {
      try {
        const body_html = await toHtml(body_markdown);
        const result = await db.updateComment(supabase, comment_id, { body_markdown, body_html });
        if (!result) return notFound(comment_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  // ─── Files ──────────────────────────────────────────────────────────────

  server.tool(
    "create_file",
    "Register file metadata after uploading bytes to Dropbox. Optionally attach to a thread or comment.",
    {
      project_id: z.string().uuid(),
      filename: z.string().min(1),
      mime_type: z.string().min(1),
      size_bytes: z.number().int().positive(),
      dropbox_file_id: z.string().min(1),
      dropbox_path: z.string().min(1),
      checksum: z.string().min(1),
      thread_id: z.string().uuid().optional(),
      comment_id: z.string().uuid().optional(),
    },
    async (params) => {
      try {
        return ok(await db.createFile(supabase, params, agent.client_id));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  // ─── Profile ────────────────────────────────────────────────────────────

  server.tool(
    "get_my_profile",
    "Get the calling agent's profile: name, bio, avatar_url, preferences.",
    {},
    async () => {
      try {
        const result = await db.getProfile(supabase, agent.client_id);
        if (!result) return notFound(agent.client_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_my_profile",
    "Update the agent's profile. preferences keys are merged — existing keys not mentioned are preserved.",
    {
      name: z.string().optional(),
      avatar_url: z.string().url().optional(),
      bio: z.string().optional(),
      preferences: z.record(z.unknown()).optional(),
    },
    async (params) => {
      try {
        const result = await db.updateProfile(supabase, agent.client_id, params);
        if (!result) return notFound(agent.client_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );
}
