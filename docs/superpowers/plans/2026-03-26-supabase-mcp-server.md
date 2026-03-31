# Supabase Edge MCP Server — Implementation Plan

> **STATUS: CLOSED** (2026-03-31) — Edge function, migrations, and MCP unit/integration tests exist in-repo. Do not dispatch new work from this document without authoring a new plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a Supabase Edge Function that exposes basecamp-clone data to AI agents (Claude, Codex, Cursor, OpenClaw) via 15 MCP tools covering projects, threads, comments, files, and agent profiles.

**Architecture:** A Deno edge function (`supabase/functions/basecamp-mcp/`) handles auth by looking up the agent in an `agent_clients` DB table, rate-limits per client, then dispatches MCP JSON-RPC requests to typed tool handlers. Business logic (auth.ts, db.ts, tools.ts) uses bare specifiers resolvable by both Deno (via deno.json import map) and Vitest (via node_modules). Only index.ts is Deno-specific.

**Tech Stack:** Deno (edge runtime), `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `bcryptjs`, `marked`, `zod`, Vitest (unit tests)

**Spec:** `docs/superpowers/specs/2026-03-26-supabase-mcp-server-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/0011_mcp_agents.sql` | Create | agent_clients + agent_profiles tables + search RPC |
| `supabase/functions/basecamp-mcp/deno.json` | Create | Import map: bare specifiers → npm: for Deno |
| `supabase/functions/basecamp-mcp/auth.ts` | Create | Agent auth (DB lookup + bcrypt), rate limiter, profile auto-create |
| `supabase/functions/basecamp-mcp/db.ts` | Create | Typed Supabase query helpers for all 15 tools |
| `supabase/functions/basecamp-mcp/tools.ts` | Create | Register all 15 MCP tools with McpServer |
| `supabase/functions/basecamp-mcp/index.ts` | Create | Deno entry point: routing, auth, rate limit, McpServer wiring |
| `tests/unit/mcp-auth.test.ts` | Create | Auth module unit tests |
| `tests/unit/mcp-read-tools.test.ts` | Create | Read tool handler unit tests |
| `tests/unit/mcp-write-tools.test.ts` | Create | Write tool handler unit tests |
| `tests/unit/mcp-file-profile-tools.test.ts` | Create | File + profile tool handler unit tests |
| `tests/integration/mcp-smoke.test.ts` | Create | Live edge function smoke test |
| `vitest.config.ts` | Modify | Add supabase/functions to test include path |
| `.env.example` | Modify | Add MCP env vars |

---

## Task 1: Project Setup

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `supabase/functions/basecamp-mcp/deno.json`

- [x] **Step 1: Install test dependencies**

```bash
npm install --save-dev bcryptjs @types/bcryptjs
```

Expected: `bcryptjs` and `@types/bcryptjs` added to `devDependencies` in package.json.

- [x] **Step 2: Update vitest.config.ts to include edge function files**

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("tests/support/server-only.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
```

Note: No changes needed to the include pattern — `tests/**/*.test.ts` already covers the new test files. The edge function source files (auth.ts, db.ts, tools.ts) use bare specifiers that resolve through node_modules. Only index.ts uses Deno-specific APIs and is not unit-tested.

- [x] **Step 3: Create deno.json import map**

```json
{
  "imports": {
    "bcryptjs": "npm:bcryptjs",
    "@supabase/supabase-js": "npm:@supabase/supabase-js",
    "marked": "npm:marked",
    "zod": "npm:zod",
    "@modelcontextprotocol/sdk/server/mcp.js": "npm:@modelcontextprotocol/sdk/server/mcp.js",
    "@modelcontextprotocol/sdk/server/streamableHttp.js": "npm:@modelcontextprotocol/sdk/server/streamableHttp.js",
    "@modelcontextprotocol/sdk/types.js": "npm:@modelcontextprotocol/sdk/types.js"
  }
}
```

Save to: `supabase/functions/basecamp-mcp/deno.json`

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json vitest.config.ts supabase/functions/basecamp-mcp/deno.json
git commit -m "chore: setup for basecamp-mcp edge function"
```

---

## Task 2: DB Migration

**Files:**
- Create: `supabase/migrations/0011_mcp_agents.sql`

- [x] **Step 1: Write the migration**

```sql
-- agent_clients: stores per-agent credentials (replaces MCP_CLIENTS_JSON env var)
create table if not exists agent_clients (
  client_id   text primary key,
  secret_hash text not null,
  role        text not null default 'agent',
  disabled    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- agent_profiles: editable identity per agent, auto-created on first auth
create table if not exists agent_profiles (
  client_id   text primary key references agent_clients(client_id) on delete cascade,
  name        text,
  avatar_url  text,
  bio         text,
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Full-text search RPC: searches threads and comments across the project
create or replace function mcp_search_content(
  p_query text,
  p_project_id uuid default null,
  p_limit int default 20
)
returns table (
  result_type text,
  result_id uuid,
  project_id uuid,
  title text,
  excerpt text,
  created_at timestamptz
)
language sql stable as $$
  select
    'thread' as result_type,
    t.id as result_id,
    t.project_id,
    t.title,
    left(t.body_markdown, 200) as excerpt,
    t.created_at
  from discussion_threads t
  where
    to_tsvector('english', t.title || ' ' || t.body_markdown) @@ plainto_tsquery('english', p_query)
    and (p_project_id is null or t.project_id = p_project_id)
  union all
  select
    'comment' as result_type,
    c.id as result_id,
    c.project_id,
    null as title,
    left(c.body_markdown, 200) as excerpt,
    c.created_at
  from discussion_comments c
  where
    to_tsvector('english', c.body_markdown) @@ plainto_tsquery('english', p_query)
    and (p_project_id is null or c.project_id = p_project_id)
  order by created_at desc
  limit least(p_limit, 100)
$$;
```

Save to: `supabase/migrations/0011_mcp_agents.sql`

- [x] **Step 2: Apply migration**

```bash
# If using Supabase CLI:
npx supabase db push

# Or paste into Supabase dashboard > SQL editor and run it manually.
# Verify: both tables and the RPC appear in the schema.
```

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/0011_mcp_agents.sql
git commit -m "feat(mcp): add agent_clients, agent_profiles tables and search RPC"
```

---

## Task 3: Auth Module

**Files:**
- Create: `supabase/functions/basecamp-mcp/auth.ts`
- Create: `tests/unit/mcp-auth.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/unit/mcp-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import {
  AuthError,
  createRateLimiter,
  resolveAgent,
  ensureProfile,
} from "../../supabase/functions/basecamp-mcp/auth.ts";

function mockSupabase(row: object | null, error: object | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select, upsert: vi.fn().mockResolvedValue({ error: null }) });
  return { from } as any;
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter(3);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent1")).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter(2);
    limiter.consume("agent1");
    limiter.consume("agent1");
    expect(limiter.consume("agent1")).toBe(false);
  });

  it("tracks limits per client_id independently", () => {
    const limiter = createRateLimiter(1);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent2")).toBe(true);
    expect(limiter.consume("agent1")).toBe(false);
  });
});

describe("resolveAgent", () => {
  it("throws AuthError when clientId is null", async () => {
    await expect(resolveAgent({} as any, null, "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when secret is null", async () => {
    await expect(resolveAgent({} as any, "mcp-test-client", null))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when agent not found in DB", async () => {
    const supabase = mockSupabase(null, { message: "not found" });
    await expect(resolveAgent(supabase, "mcp-test-client", "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when agent is disabled", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: true });
    await expect(resolveAgent(supabase, "mcp-test-client", "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when secret is wrong", async () => {
    const hash = await bcrypt.hash("correct", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: false });
    await expect(resolveAgent(supabase, "mcp-test-client", "wrong"))
      .rejects.toThrow(AuthError);
  });

  it("returns identity when credentials are valid", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: false });
    const identity = await resolveAgent(supabase, "mcp-test-client", "secret");
    expect(identity).toEqual({ client_id: "mcp-test-client", role: "agent" });
  });
});

describe("ensureProfile", () => {
  it("upserts a profile row with ignoreDuplicates", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    await ensureProfile({ from } as any, "mcp-test-client");
    expect(from).toHaveBeenCalledWith("agent_profiles");
    expect(upsert).toHaveBeenCalledWith(
      { client_id: "mcp-test-client" },
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-auth.test.ts
```

Expected: FAIL — `Cannot find module '../../supabase/functions/basecamp-mcp/auth.ts'`

- [x] **Step 3: Implement auth.ts**

```typescript
// supabase/functions/basecamp-mcp/auth.ts
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AgentIdentity {
  client_id: string;
  role: string;
}

export interface RateLimiter {
  consume(key: string): boolean;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AuthError";
  }
}

export function createRateLimiter(rpmLimit: number): RateLimiter {
  const windows = new Map<string, number[]>();
  return {
    consume(key: string): boolean {
      const now = Date.now();
      const windowMs = 60_000;
      const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
      if (hits.length >= rpmLimit) return false;
      hits.push(now);
      windows.set(key, hits);
      return true;
    },
  };
}

export async function resolveAgent(
  supabase: SupabaseClient,
  clientId: string | null,
  secret: string | null
): Promise<AgentIdentity> {
  if (!clientId || !secret) throw new AuthError("Missing credentials", 401);

  const { data, error } = await supabase
    .from("agent_clients")
    .select("client_id, secret_hash, role, disabled")
    .eq("client_id", clientId)
    .single();

  if (error || !data) throw new AuthError("Unknown agent", 401);
  if (data.disabled) throw new AuthError("Agent disabled", 401);

  const valid = await bcrypt.compare(secret, data.secret_hash);
  if (!valid) throw new AuthError("Invalid secret", 401);

  return { client_id: data.client_id, role: data.role };
}

export async function ensureProfile(
  supabase: SupabaseClient,
  clientId: string
): Promise<void> {
  await supabase
    .from("agent_profiles")
    .upsert({ client_id: clientId }, { onConflict: "client_id", ignoreDuplicates: true });
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/mcp-auth.test.ts
```

Expected: All 9 tests PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/auth.ts tests/unit/mcp-auth.test.ts
git commit -m "feat(mcp): auth module with rate limiter and bcrypt agent resolution"
```

---

## Task 4: DB Query Helpers

**Files:**
- Create: `supabase/functions/basecamp-mcp/db.ts`

No dedicated tests — these helpers are thin wrappers tested through tool tests in Tasks 5–7.

- [x] **Step 1: Implement db.ts**

```typescript
// supabase/functions/basecamp-mcp/db.ts
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listProjects(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, description, deadline, status, created_at, clients(name)")
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((p: any) => ({ ...p, client_name: p.clients?.name ?? null, clients: undefined }));
}

export async function getProject(supabase: SupabaseClient, projectId: string) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, slug, description, deadline, status, archived, created_at, clients(id, name)")
    .eq("id", projectId)
    .single();
  if (error || !project) return null;

  const { data: threads } = await supabase
    .from("discussion_threads")
    .select("id, title, created_at, discussion_comments(count)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { count: fileCount } = await supabase
    .from("project_files")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  return {
    project: { ...project, client: project.clients, clients: undefined },
    threads: (threads ?? []).map((t: any) => ({
      id: t.id,
      title: t.title,
      comment_count: t.discussion_comments?.[0]?.count ?? 0,
      created_at: t.created_at,
    })),
    file_count: fileCount ?? 0,
  };
}

export async function getThread(supabase: SupabaseClient, threadId: string) {
  const { data: thread, error } = await supabase
    .from("discussion_threads")
    .select("id, project_id, title, body_markdown, author_user_id, created_at, updated_at")
    .eq("id", threadId)
    .single();
  if (error || !thread) return null;

  const { data: comments } = await supabase
    .from("discussion_comments")
    .select("id, body_markdown, author_user_id, edited_at, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  const { data: threadFiles } = await supabase
    .from("project_files")
    .select("id, filename, mime_type, size_bytes, dropbox_file_id, comment_id, created_at")
    .eq("thread_id", threadId)
    .is("comment_id", null);

  const { data: commentFiles } = await supabase
    .from("project_files")
    .select("id, filename, mime_type, size_bytes, dropbox_file_id, comment_id, created_at")
    .eq("thread_id", threadId)
    .not("comment_id", "is", null);

  const filesByComment = new Map<string, any[]>();
  for (const f of commentFiles ?? []) {
    const arr = filesByComment.get(f.comment_id) ?? [];
    arr.push(f);
    filesByComment.set(f.comment_id, arr);
  }

  return {
    thread,
    comments: (comments ?? []).map((c: any) => ({
      ...c,
      files: filesByComment.get(c.id) ?? [],
    })),
    files: threadFiles ?? [],
  };
}

export async function listFiles(supabase: SupabaseClient, projectId: string, threadId?: string) {
  let query = supabase
    .from("project_files")
    .select("id, filename, mime_type, size_bytes, dropbox_file_id, thread_id, comment_id, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (threadId) query = query.eq("thread_id", threadId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getFile(supabase: SupabaseClient, fileId: string) {
  const { data, error } = await supabase
    .from("project_files")
    .select("id, project_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum, thread_id, comment_id, uploader_user_id, created_at")
    .eq("id", fileId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function searchContent(
  supabase: SupabaseClient,
  query: string,
  projectId?: string,
  limit = 20
) {
  const { data, error } = await supabase.rpc("mcp_search_content", {
    p_query: query,
    p_project_id: projectId ?? null,
    p_limit: Math.min(limit, 100),
  });
  if (error) throw error;
  return data;
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function createProject(
  supabase: SupabaseClient,
  params: { name: string; description?: string; deadline?: string; business_client_id?: string },
  agentId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: params.name,
      slug: params.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      description: params.description ?? null,
      deadline: params.deadline ?? null,
      client_id: params.business_client_id ?? null,
      created_by: agentId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  params: { name?: string; description?: string; deadline?: string; status?: string; archived?: boolean }
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.deadline !== undefined) patch.deadline = params.deadline;
  if (params.status !== undefined) patch.status = params.status;
  if (params.archived !== undefined) patch.archived = params.archived;

  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .select()
    .single();
  if (error || !data) return null;
  return data;
}

export async function createThread(
  supabase: SupabaseClient,
  params: { project_id: string; title: string; body_markdown: string; body_html: string },
  agentId: string
) {
  const { data, error } = await supabase
    .from("discussion_threads")
    .insert({
      project_id: params.project_id,
      title: params.title,
      body_markdown: params.body_markdown,
      body_html: params.body_html,
      author_user_id: agentId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateThread(
  supabase: SupabaseClient,
  threadId: string,
  params: { title?: string; body_markdown?: string; body_html?: string }
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.title !== undefined) patch.title = params.title;
  if (params.body_markdown !== undefined) patch.body_markdown = params.body_markdown;
  if (params.body_html !== undefined) patch.body_html = params.body_html;

  const { data, error } = await supabase
    .from("discussion_threads")
    .update(patch)
    .eq("id", threadId)
    .select()
    .single();
  if (error || !data) return null;
  return data;
}

export async function createComment(
  supabase: SupabaseClient,
  params: { thread_id: string; body_markdown: string; body_html: string; project_id: string },
  agentId: string
) {
  const { data, error } = await supabase
    .from("discussion_comments")
    .insert({
      thread_id: params.thread_id,
      project_id: params.project_id,
      body_markdown: params.body_markdown,
      body_html: params.body_html,
      author_user_id: agentId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateComment(
  supabase: SupabaseClient,
  commentId: string,
  params: { body_markdown: string; body_html: string }
) {
  const { data, error } = await supabase
    .from("discussion_comments")
    .update({
      body_markdown: params.body_markdown,
      body_html: params.body_html,
      edited_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select()
    .single();
  if (error || !data) return null;
  return data;
}

// ─── Files ───────────────────────────────────────────────────────────────────

export async function createFile(
  supabase: SupabaseClient,
  params: {
    project_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    dropbox_file_id: string;
    dropbox_path: string;
    checksum: string;
    thread_id?: string;
    comment_id?: string;
  },
  agentId: string
) {
  const { data, error } = await supabase
    .from("project_files")
    .insert({
      project_id: params.project_id,
      filename: params.filename,
      mime_type: params.mime_type,
      size_bytes: params.size_bytes,
      dropbox_file_id: params.dropbox_file_id,
      dropbox_path: params.dropbox_path,
      checksum: params.checksum,
      thread_id: params.thread_id ?? null,
      comment_id: params.comment_id ?? null,
      uploader_user_id: agentId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function getProfile(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase
    .from("agent_profiles")
    .select("client_id, name, avatar_url, bio, preferences, created_at, updated_at")
    .eq("client_id", clientId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function updateProfile(
  supabase: SupabaseClient,
  clientId: string,
  params: { name?: string; avatar_url?: string; bio?: string; preferences?: Record<string, unknown> }
) {
  // Fetch current preferences for key-merge
  const { data: current } = await supabase
    .from("agent_profiles")
    .select("preferences")
    .eq("client_id", clientId)
    .single();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) patch.name = params.name;
  if (params.avatar_url !== undefined) patch.avatar_url = params.avatar_url;
  if (params.bio !== undefined) patch.bio = params.bio;
  if (params.preferences !== undefined) {
    patch.preferences = { ...(current?.preferences ?? {}), ...params.preferences };
  }

  const { data, error } = await supabase
    .from("agent_profiles")
    .update(patch)
    .eq("client_id", clientId)
    .select()
    .single();
  if (error || !data) return null;
  return data;
}
```

- [x] **Step 2: Commit**

```bash
git add supabase/functions/basecamp-mcp/db.ts
git commit -m "feat(mcp): db query helpers for all 15 tools"
```

---

## Task 5: Read Tools

**Files:**
- Create: `supabase/functions/basecamp-mcp/tools.ts` (read tools section)
- Create: `tests/unit/mcp-read-tools.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/unit/mcp-read-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import * as db from "../../supabase/functions/basecamp-mcp/db.ts";
import { registerTools } from "../../supabase/functions/basecamp-mcp/tools.ts";

function mockServer() {
  const handlers = new Map<string, Function>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      handlers.set(name, handler);
    }),
    call: (name: string, params: any) => handlers.get(name)!(params),
  };
}

const agent = { client_id: "mcp-test-client", role: "agent" };

describe("list_projects", () => {
  it("returns projects as JSON text content", async () => {
    vi.spyOn(db, "listProjects").mockResolvedValue([
      { id: "proj-1", name: "Test Project", slug: "test-project", status: "new", created_at: "2026-01-01" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("list_projects", {});
    expect(result.content[0].type).toBe("text");
    const data = JSON.parse(result.content[0].text);
    expect(data[0].name).toBe("Test Project");
  });
});

describe("get_project", () => {
  it("returns project detail", async () => {
    vi.spyOn(db, "getProject").mockResolvedValue({
      project: { id: "proj-1", name: "Test" },
      threads: [],
      file_count: 3,
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_project", { project_id: "proj-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.file_count).toBe(3);
  });

  it("returns error content when project not found", async () => {
    vi.spyOn(db, "getProject").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_project", { project_id: "bad-id" });
    expect(result.isError).toBe(true);
  });
});

describe("get_thread", () => {
  it("returns thread with comments and files", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", title: "My Thread" },
      comments: [{ id: "c-1", body_markdown: "hello", files: [] }],
      files: [],
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_thread", { thread_id: "t-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.thread.title).toBe("My Thread");
    expect(data.comments).toHaveLength(1);
  });

  it("returns error when thread not found", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_thread", { thread_id: "bad" });
    expect(result.isError).toBe(true);
  });
});

describe("list_files", () => {
  it("returns files for a project", async () => {
    vi.spyOn(db, "listFiles").mockResolvedValue([
      { id: "f-1", filename: "doc.pdf", mime_type: "application/pdf" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("list_files", { project_id: "proj-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].filename).toBe("doc.pdf");
  });
});

describe("get_file", () => {
  it("returns file metadata", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue({ id: "f-1", filename: "doc.pdf" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_file", { file_id: "f-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.filename).toBe("doc.pdf");
  });

  it("returns error when file not found", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_file", { file_id: "bad" });
    expect(result.isError).toBe(true);
  });
});

describe("search_content", () => {
  it("returns search results", async () => {
    vi.spyOn(db, "searchContent").mockResolvedValue([
      { result_type: "thread", result_id: "t-1", excerpt: "hello world" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("search_content", { query: "hello" });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].result_type).toBe("thread");
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-read-tools.test.ts
```

Expected: FAIL — `Cannot find module '../../supabase/functions/basecamp-mcp/tools.ts'`

- [x] **Step 3: Implement tools.ts (read tools only)**

```typescript
// supabase/functions/basecamp-mcp/tools.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentIdentity } from "./auth.ts";
import * as db from "./db.ts";
import { marked } from "marked";

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
  server: McpServer,
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

  // Write and file/profile tools added in subsequent tasks
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/mcp-read-tools.test.ts
```

Expected: All 8 tests PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-read-tools.test.ts
git commit -m "feat(mcp): read tools — list_projects, get_project, get_thread, list_files, get_file, search_content"
```

---

## Task 6: Write Tools

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Create: `tests/unit/mcp-write-tools.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/unit/mcp-write-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import * as db from "../../supabase/functions/basecamp-mcp/db.ts";
import { registerTools } from "../../supabase/functions/basecamp-mcp/tools.ts";

function mockServer() {
  const handlers = new Map<string, Function>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      handlers.set(name, handler);
    }),
    call: (name: string, params: any) => handlers.get(name)!(params),
  };
}

const agent = { client_id: "mcp-test-client", role: "agent" };

describe("create_project", () => {
  it("creates a project and stamps author_user_id from agent", async () => {
    const created = { id: "p-1", name: "New Project", created_by: "mcp-test-client" };
    const spy = vi.spyOn(db, "createProject").mockResolvedValue(created as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("create_project", { name: "New Project" });
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "New Project" }), "mcp-test-client");
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("New Project");
  });
});

describe("update_project", () => {
  it("returns updated project", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue({ id: "p-1", name: "Renamed" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_project", { project_id: "p-1", name: "Renamed" });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("Renamed");
  });

  it("returns error when project not found", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_project", { project_id: "bad-id" });
    expect(result.isError).toBe(true);
  });
});

describe("create_thread", () => {
  it("converts markdown to HTML before saving", async () => {
    const spy = vi.spyOn(db, "createThread").mockResolvedValue({ id: "t-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_thread", {
      project_id: "p-1",
      title: "Hello",
      body_markdown: "**bold**",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body_markdown: "**bold**", body_html: expect.stringContaining("<strong>") }),
      "mcp-test-client"
    );
  });
});

describe("update_thread", () => {
  it("converts updated markdown to HTML", async () => {
    const spy = vi.spyOn(db, "updateThread").mockResolvedValue({ id: "t-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_thread", { thread_id: "t-1", body_markdown: "_italic_" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      "t-1",
      expect.objectContaining({ body_html: expect.stringContaining("<em>") })
    );
  });
});

describe("create_comment", () => {
  it("looks up project_id from thread before inserting", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", project_id: "proj-1" },
      comments: [],
      files: [],
    } as any);
    const spy = vi.spyOn(db, "createComment").mockResolvedValue({ id: "c-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_comment", { thread_id: "t-1", body_markdown: "hi" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ project_id: "proj-1" }),
      "mcp-test-client"
    );
  });
});

describe("update_comment", () => {
  it("returns error when comment not found", async () => {
    vi.spyOn(db, "updateComment").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_comment", {
      comment_id: "bad",
      body_markdown: "new content",
    });
    expect(result.isError).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-write-tools.test.ts
```

Expected: FAIL — tools not yet registered in tools.ts.

- [x] **Step 3: Add write tools to tools.ts**

Append inside the `registerTools` function, after the read tools section:

```typescript
  // ─── Write ──────────────────────────────────────────────────────────────

  server.tool(
    "create_project",
    "Create a new project. business_client_id is the UUID of a row in the clients table.",
    {
      name: z.string().min(1),
      description: z.string().optional(),
      deadline: z.string().date().optional(),
      business_client_id: z.string().uuid().optional(),
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
    "Update mutable project fields. Only provided fields are changed. status must be one of: new, in_progress, blocked, complete.",
    {
      project_id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      deadline: z.string().date().optional(),
      status: z.enum(["new", "in_progress", "blocked", "complete"]).optional(),
      archived: z.boolean().optional(),
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
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/mcp-write-tools.test.ts
```

Expected: All 7 tests PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-write-tools.test.ts
git commit -m "feat(mcp): write tools — create/update project, thread, comment"
```

---

## Task 7: File and Profile Tools

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Create: `tests/unit/mcp-file-profile-tools.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// tests/unit/mcp-file-profile-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import * as db from "../../supabase/functions/basecamp-mcp/db.ts";
import { registerTools } from "../../supabase/functions/basecamp-mcp/tools.ts";

function mockServer() {
  const handlers = new Map<string, Function>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      handlers.set(name, handler);
    }),
    call: (name: string, params: any) => handlers.get(name)!(params),
  };
}

const agent = { client_id: "mcp-test-client", role: "agent" };

describe("create_file", () => {
  it("registers file metadata with agent as uploader", async () => {
    const spy = vi.spyOn(db, "createFile").mockResolvedValue({ id: "f-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const params = {
      project_id: "p-1",
      filename: "doc.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      dropbox_file_id: "id:abc",
      dropbox_path: "/test-uploads/p-1/doc.pdf",
      checksum: "sha256:abc",
    };
    await server.call("create_file", params);
    expect(spy).toHaveBeenCalledWith(expect.anything(), params, "mcp-test-client");
  });

  it("accepts optional thread_id and comment_id", async () => {
    const spy = vi.spyOn(db, "createFile").mockResolvedValue({ id: "f-2" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_file", {
      project_id: "p-1",
      filename: "img.png",
      mime_type: "image/png",
      size_bytes: 500,
      dropbox_file_id: "id:xyz",
      dropbox_path: "/test-uploads/p-1/img.png",
      checksum: "sha256:xyz",
      thread_id: "t-1",
      comment_id: "c-1",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ thread_id: "t-1", comment_id: "c-1" }),
      "mcp-test-client"
    );
  });
});

describe("get_my_profile", () => {
  it("returns the calling agent's profile", async () => {
    vi.spyOn(db, "getProfile").mockResolvedValue({
      client_id: "mcp-test-client",
      name: "Claude",
      bio: "AI assistant",
      preferences: {},
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_my_profile", {});
    const data = JSON.parse(result.content[0].text);
    expect(data.client_id).toBe("mcp-test-client");
    expect(data.name).toBe("Claude");
  });

  it("returns error when profile not found", async () => {
    vi.spyOn(db, "getProfile").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_my_profile", {});
    expect(result.isError).toBe(true);
  });
});

describe("update_my_profile", () => {
  it("updates agent profile with provided fields", async () => {
    const spy = vi.spyOn(db, "updateProfile").mockResolvedValue({
      client_id: "mcp-test-client",
      name: "Claude Agent",
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_my_profile", { name: "Claude Agent" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      "mcp-test-client",
      expect.objectContaining({ name: "Claude Agent" })
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("Claude Agent");
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-file-profile-tools.test.ts
```

Expected: FAIL — tools not yet registered.

- [x] **Step 3: Add file and profile tools to tools.ts**

Append inside `registerTools`, after the write tools section:

```typescript
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
```

- [x] **Step 4: Run all unit tests**

```bash
npx vitest run tests/unit/mcp-auth.test.ts tests/unit/mcp-read-tools.test.ts tests/unit/mcp-write-tools.test.ts tests/unit/mcp-file-profile-tools.test.ts
```

Expected: All tests PASS.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-file-profile-tools.test.ts
git commit -m "feat(mcp): file and profile tools — create_file, get_my_profile, update_my_profile"
```

---

## Task 8: Edge Function Entry Point

**Files:**
- Create: `supabase/functions/basecamp-mcp/index.ts`

No unit tests — index.ts is Deno-specific (Deno.serve, Deno.env) and is covered by the integration smoke test.

- [x] **Step 1: Implement index.ts**

```typescript
// supabase/functions/basecamp-mcp/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { resolveAgent, ensureProfile, createRateLimiter, AuthError } from "./auth.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RPM_LIMIT = parseInt(Deno.env.get("MCP_RATE_LIMIT_RPM") ?? "120", 10);

// Module-level singletons — shared across requests in the same isolate
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rateLimiter = createRateLimiter(RPM_LIMIT);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Liveness
  if (url.pathname.endsWith("/healthz")) {
    return new Response("ok", { status: 200, headers: SECURITY_HEADERS });
  }

  // Readiness — verify Supabase is reachable
  if (url.pathname.endsWith("/readyz")) {
    const { error } = await supabase.from("agent_clients").select("client_id").limit(1);
    if (error) return new Response("unavailable", { status: 503, headers: SECURITY_HEADERS });
    return new Response("ok", { status: 200, headers: SECURITY_HEADERS });
  }

  // Auth
  const authHeader = req.headers.get("authorization") ?? "";
  const clientId = req.headers.get("x-mcp-client-id");
  const secret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let agent;
  try {
    agent = await resolveAgent(supabase, clientId, secret);
  } catch (e) {
    if (e instanceof AuthError) {
      return new Response(e.message, { status: e.status, headers: SECURITY_HEADERS });
    }
    return new Response("Internal error", { status: 500, headers: SECURITY_HEADERS });
  }

  // Rate limit
  if (!rateLimiter.consume(agent.client_id)) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...SECURITY_HEADERS, "Retry-After": "60" },
    });
  }

  // Auto-create profile on first auth
  await ensureProfile(supabase, agent.client_id);

  // MCP — fresh server per request
  const server = new McpServer({ name: "basecamp-mcp", version: "1.0.0" });
  registerTools(server, supabase, agent);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
});
```

- [x] **Step 2: Commit**

```bash
git add supabase/functions/basecamp-mcp/index.ts
git commit -m "feat(mcp): Deno edge function entry point with auth, rate limiting, and MCP routing"
```

---

## Task 9: Env Example

**Files:**
- Modify: `.env.example`

- [x] **Step 1: Add MCP vars to .env.example**

Open `.env.example` and append:

```bash
# ─── MCP Server ──────────────────────────────────────────────────────────────
# Admin keys (at least one required to bootstrap first agent_clients row)
MCP_ACCESS_KEY=
MCP_ACCESS_KEYS=

# Rate limiting — requests per minute per agent (default: 120)
MCP_RATE_LIMIT_RPM=120

# Agent credentials are stored in the agent_clients DB table.
# To add an agent, insert a row with a bcrypt-hashed secret:
#   insert into agent_clients (client_id, secret_hash, role)
#   values ('mcp-test-client', crypt('your-secret', gen_salt('bf')), 'agent');
# Note: requires pgcrypto extension (already enabled in migration 0001).

# ─── Integration Smoke Test ───────────────────────────────────────────────────
MCP_SMOKE_URL=
MCP_SMOKE_CLIENT_ID=
MCP_SMOKE_SECRET=
```

- [x] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(mcp): add MCP env vars to .env.example"
```

---

## Task 10: Integration Smoke Test

**Files:**
- Create: `tests/integration/mcp-smoke.test.ts`

Requires a deployed edge function and env vars: `MCP_SMOKE_URL`, `MCP_SMOKE_CLIENT_ID`, `MCP_SMOKE_SECRET`. Not run in CI.

- [x] **Step 1: Deploy the edge function**

```bash
npx supabase functions deploy basecamp-mcp
```

Note the function URL — it will be:
`https://<project-ref>.supabase.co/functions/v1/basecamp-mcp`

Set in `.env.local`:
```
MCP_SMOKE_URL=https://<project-ref>.supabase.co/functions/v1/basecamp-mcp
MCP_SMOKE_CLIENT_ID=<your-client-id>
MCP_SMOKE_SECRET=<the secret you inserted into agent_clients>
```

- [x] **Step 2: Insert a test agent into agent_clients**

In the Supabase dashboard > SQL editor:

```sql
-- Insert a test agent (uses pgcrypto, already enabled)
insert into agent_clients (client_id, secret_hash, role)
values (
  'mcp-test-client',
  crypt('your-secret-here', gen_salt('bf')),
  'agent'
)
on conflict (client_id) do nothing;
```

- [x] **Step 3: Write the smoke test**

```typescript
// tests/integration/mcp-smoke.test.ts
import { describe, it, expect, beforeAll } from "vitest";

// Skip entire suite when smoke env vars are absent
const SMOKE_URL = process.env.MCP_SMOKE_URL;
const CLIENT_ID = process.env.MCP_SMOKE_CLIENT_ID;
const SECRET = process.env.MCP_SMOKE_SECRET;

describe.skipIf(!SMOKE_URL || !CLIENT_ID || !SECRET)("MCP smoke tests (live)", () => {
  async function mcpCall(method: string, params: Record<string, unknown>) {
    const res = await fetch(SMOKE_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
        "x-mcp-client-id": CLIENT_ID!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    return res.json();
  }

  it("GET /healthz returns 200", async () => {
    const res = await fetch(`${SMOKE_URL}/healthz`);
    expect(res.status).toBe(200);
  });

  it("GET /readyz returns 200", async () => {
    const res = await fetch(`${SMOKE_URL}/readyz`);
    expect(res.status).toBe(200);
  });

  it("rejects bad credentials with 401", async () => {
    const res = await fetch(SMOKE_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bad-secret",
        "x-mcp-client-id": CLIENT_ID!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("tools/list returns all 15 tools", async () => {
    const response = await mcpCall("tools/list", {});
    expect(response.result?.tools).toHaveLength(15);
    const names = response.result.tools.map((t: any) => t.name);
    expect(names).toContain("list_projects");
    expect(names).toContain("get_my_profile");
    expect(names).toContain("create_file");
  });

  it("list_projects returns array", async () => {
    const response = await mcpCall("tools/call", {
      name: "list_projects",
      arguments: {},
    });
    const data = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(Array.isArray(data)).toBe(true);
  });

  it("get_my_profile returns agent identity", async () => {
    const response = await mcpCall("tools/call", {
      name: "get_my_profile",
      arguments: {},
    });
    const data = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(data.client_id).toBe(CLIENT_ID);
  });
});
```

- [x] **Step 4: Run smoke tests**

```bash
MCP_SMOKE_URL=https://... MCP_SMOKE_CLIENT_ID=<your-client-id> MCP_SMOKE_SECRET=your-secret npx vitest run tests/integration/mcp-smoke.test.ts
```

Expected: All 6 tests PASS (skip message if env vars absent).

- [x] **Step 5: Final unit test run**

```bash
npx vitest run tests/unit/mcp-auth.test.ts tests/unit/mcp-read-tools.test.ts tests/unit/mcp-write-tools.test.ts tests/unit/mcp-file-profile-tools.test.ts
```

Expected: All tests PASS.

- [x] **Step 6: Commit**

```bash
git add tests/integration/mcp-smoke.test.ts
git commit -m "test(mcp): integration smoke test for live edge function"
```

---

## Connecting an Agent

Add to `.mcp.json` or `~/.mcp-test-client.json`:

```json
{
  "mcpServers": {
    "basecamp": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/basecamp-mcp",
      "headers": {
        "Authorization": "Bearer <your-secret>",
        "x-mcp-client-id": "mcp-test-client"
      }
    }
  }
}
```
