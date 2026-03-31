# Basecamp 2 → Supabase Migration Implementation Plan

> **STATUS: CLOSED** (2026-03-31) — `lib/imports/bc2-*`, `scripts/migrate-bc2.ts`, migration `0014`, and unit tests are in-repo; integration BC2 tests remain opt-in/skipped without `DATABASE_URL`. Do not dispatch new work from this document without authoring a new plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone CLI migration script (`scripts/migrate-bc2.ts`) that fetches all data from the Basecamp 2 API and imports it into Supabase using the existing `import_jobs`/`import_logs`/`import_map_*` infrastructure.

**Architecture:** Four new library files (HTTP client, fetcher, transformer, orchestrator) plus a CLI entry point. Data flows project-by-project via async generators (never load all into memory). All inserts are idempotent via `import_map_*` tables. The script supports dry/limited/full modes and is safe to re-run.

**Tech Stack:** TypeScript (`tsx`), `node-fetch` or native `fetch` (Node 18+), `lib/db.ts` (`query()`), `lib/repositories.ts`, existing `import_jobs`/`import_logs` Supabase tables, Dropbox upload protocol from existing code.

---

## Spec Correction

> **IMPORTANT**: The spec references migration `0012_bc2_people_map.sql`. Migrations 0012 and 0013 are already taken (`0012_project_files_thumbnail_url.sql`, `0013_thumbnail_jobs.sql`). The correct file is **`0014_bc2_people_map.sql`**.

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `supabase/migrations/0014_bc2_people_map.sql` | **Create** | `import_map_people` table + `user_profiles.is_legacy` column |
| `.env.example` | **Modify** | Add `BC2_ACCOUNT_ID`, `BC2_ACCESS_TOKEN`, `BC2_USER_AGENT`, `BC2_REQUEST_DELAY_MS` |
| `lib/imports/bc2-client.ts` | **Create** | BC2 HTTP client: Basic auth, pagination `next` links, 429 backoff |
| `lib/imports/bc2-fetcher.ts` | **Create** | Async generators for each BC2 resource type |
| `lib/imports/bc2-transformer.ts` | **Create** | Title parsing, client inference, people → profile mapping |
| `scripts/migrate-bc2.ts` | **Create** | CLI entry: flag parsing, job creation, full orchestration, SIGINT |
| `app/auth/callback/route.ts` (or wherever `createUserProfile` is called) | **Modify** | Add legacy profile reconciliation on first Google login |
| `tests/unit/bc2-client.test.ts` | **Create** | Unit tests for HTTP client (rate limiting, backoff, pagination) |
| `tests/unit/bc2-transformer.test.ts` | **Create** | Unit tests for title parsing and client inference |
| `tests/integration/bc2-migrate.test.ts` | **Create** | Integration smoke test + idempotency |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0014_bc2_people_map.sql`

- [x] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0014_bc2_people_map.sql

-- Map BC2 person IDs to local user_profile IDs
create table if not exists import_map_people (
  id uuid primary key default gen_random_uuid(),
  basecamp_person_id text not null unique,
  local_user_profile_id text not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Flag legacy (dormant) profiles created from BC2 people
alter table user_profiles
  add column if not exists is_legacy boolean not null default false;

-- Index for fast email lookup during Google login reconciliation
create index if not exists idx_user_profiles_legacy_email
  on user_profiles(email) where is_legacy = true;
```

- [x] **Step 2: Apply migration to your Supabase branch**

```bash
# Assumes DATABASE_URL is set in .env.local pointing at your dev/migration branch
npx tsx -e "
const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const sql = fs.readFileSync('supabase/migrations/0014_bc2_people_map.sql', 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => client.query(sql)).then(() => { console.log('OK'); client.end(); }).catch(e => { console.error(e); process.exit(1); });
"
```

Expected output: `OK`

- [x] **Step 3: Verify tables and columns exist**

```bash
npx tsx -e "
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  const r1 = await client.query(\"select to_regclass('public.import_map_people')\");
  const r2 = await client.query(\"select column_name from information_schema.columns where table_name='user_profiles' and column_name='is_legacy'\");
  console.log('import_map_people:', r1.rows[0].to_regclass);
  console.log('is_legacy column:', r2.rows.length > 0 ? 'present' : 'MISSING');
  client.end();
});
"
```

Expected output:
```
import_map_people: import_map_people
is_legacy column: present
```

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0014_bc2_people_map.sql
git commit -m "feat: add import_map_people table and user_profiles.is_legacy column"
```

---

## Task 2: Environment Variables

**Files:**
- Modify: `.env.example`

- [x] **Step 1: Add BC2 variables to `.env.example`**

Open `.env.example` and append:

```bash
# Basecamp 2 Migration
BC2_ACCOUNT_ID=          # numeric account ID from basecamp.com/{id}/api/v1
BC2_ACCESS_TOKEN=        # personal access token from Basecamp → My Profile → Access Tokens
BC2_USER_AGENT=          # required by BC2 API: "AppName (you@domain.com)"
BC2_REQUEST_DELAY_MS=200 # ms between requests (default 200)
```

- [x] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add BC2 migration env vars to .env.example"
```

---

## Task 3: BC2 HTTP Client

**Files:**
- Create: `lib/imports/bc2-client.ts`
- Create: `tests/unit/bc2-client.test.ts`

### Context

The BC2 API uses Basic auth via an access token (token as username, `X` as password). Every response that has more records includes a `next` link in a `Link` header. Rate limiting returns `429 Too Many Requests`.

### Step-by-step

- [x] **Step 1: Write the failing tests**

```typescript
// tests/unit/bc2-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bc2Client } from "@/lib/imports/bc2-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("Bc2Client", () => {
  let client: Bc2Client;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new Bc2Client({
      accountId: "12345",
      accessToken: "mytoken",
      userAgent: "Test (test@example.com)",
      requestDelayMs: 0
    });
  });

  it("sends correct auth and user-agent headers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await client.get("/people.json");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("basecampapi.com/12345/people.json");
    expect(init.headers["Authorization"]).toMatch(/^Basic /);
    expect(init.headers["User-Agent"]).toBe("Test (test@example.com)");
  });

  it("returns parsed JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 1, name: "Alice" }]));
    const result = await client.get("/people.json");
    expect(result.body).toEqual([{ id: 1, name: "Alice" }]);
    expect(result.nextUrl).toBeNull();
  });

  it("parses next URL from Link header", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 1 }], 200, {
        Link: '<https://basecampapi.com/12345/people.json?page=2>; rel="next"'
      })
    );
    const result = await client.get("/people.json");
    expect(result.nextUrl).toBe("https://basecampapi.com/12345/people.json?page=2");
  });

  it("retries on 429 with exponential backoff", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = client.get("/projects.json");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.body).toEqual({ ok: true });
    vi.useRealTimers();
  });

  it("throws after max backoff attempts exceeded", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const promise = client.get("/projects.json");
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/rate limit/i);
    vi.useRealTimers();
  });
});
```

- [x] **Step 2: Run to confirm they fail**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-client.test.ts
```

Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement `lib/imports/bc2-client.ts`**

```typescript
// lib/imports/bc2-client.ts

const BC2_BASE = "https://basecampapi.com";
const BACKOFF_SEQUENCE_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export interface Bc2ClientOptions {
  accountId: string;
  accessToken: string;
  userAgent: string;
  requestDelayMs?: number;
}

export interface Bc2Response<T = unknown> {
  body: T;
  nextUrl: string | null;
}

function parseNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function makeAuthHeader(accessToken: string): string {
  return "Basic " + Buffer.from(`${accessToken}:X`).toString("base64");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Bc2Client {
  private accountId: string;
  private authHeader: string;
  private userAgent: string;
  private requestDelayMs: number;

  constructor(options: Bc2ClientOptions) {
    this.accountId = options.accountId;
    this.authHeader = makeAuthHeader(options.accessToken);
    this.userAgent = options.userAgent;
    this.requestDelayMs = options.requestDelayMs ?? 200;
  }

  async get<T = unknown>(path: string): Promise<Bc2Response<T>> {
    const url = path.startsWith("https://")
      ? path
      : `${BC2_BASE}/${this.accountId}${path}`;

    if (this.requestDelayMs > 0) {
      await sleep(this.requestDelayMs);
    }

    for (let attempt = 0; attempt <= BACKOFF_SEQUENCE_MS.length; attempt++) {
      const response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          "User-Agent": this.userAgent,
          Accept: "application/json"
        }
      });

      if (response.status === 429) {
        const backoff = BACKOFF_SEQUENCE_MS[attempt];
        if (backoff === undefined) {
          throw new Error(`BC2 rate limit: max retries exceeded for ${url}`);
        }
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        throw new Error(`BC2 API error ${response.status} for ${url}`);
      }

      const body = (await response.json()) as T;
      const nextUrl = parseNextUrl(response.headers.get("Link"));
      return { body, nextUrl };
    }

    throw new Error(`BC2 rate limit: max retries exceeded for ${url}`);
  }
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-client.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/imports/bc2-client.ts tests/unit/bc2-client.test.ts
git commit -m "feat: add BC2 HTTP client with auth, pagination, and 429 backoff"
```

---

## Task 4: BC2 Fetcher (Async Generators)

**Files:**
- Create: `lib/imports/bc2-fetcher.ts`
- Create: `tests/unit/bc2-fetcher.test.ts`

### Context

The fetcher wraps `Bc2Client.get()` in async generators that follow `nextUrl` pagination. Each generator yields one page's worth of items. The script consumes these with `for await`.

BC2 API endpoints:
- `GET /people.json` — all people in the account
- `GET /projects.json` — active projects
- `GET /projects/archived.json` — archived projects
- `GET /projects/{id}/messages.json` — messages (threads) per project
- `GET /projects/{id}/messages/{msgId}/comments.json` — comments per message
- `GET /projects/{id}/attachments.json` — vault attachments per project

- [x] **Step 1: Write the failing tests**

```typescript
// tests/unit/bc2-fetcher.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bc2Fetcher } from "@/lib/imports/bc2-fetcher";
import { Bc2Client } from "@/lib/imports/bc2-client";

function makeClient(pages: Array<{ body: unknown; nextUrl?: string | null }>) {
  const client = {
    get: vi.fn()
  } as unknown as Bc2Client;
  let call = 0;
  (client.get as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const page = pages[call++];
    return Promise.resolve({ body: page.body, nextUrl: page.nextUrl ?? null });
  });
  return client;
}

describe("Bc2Fetcher", () => {
  it("yields all items across multiple pages from fetchPeople", async () => {
    const client = makeClient([
      { body: [{ id: 1, name: "Alice" }], nextUrl: "https://example.com/people.json?page=2" },
      { body: [{ id: 2, name: "Bob" }], nextUrl: null }
    ]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const person of fetcher.fetchPeople()) {
      results.push(person);
    }
    expect(results).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    expect((client.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("fetchMessages uses correct project endpoint", async () => {
    const client = makeClient([{ body: [{ id: 99, subject: "Hello" }], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const msg of fetcher.fetchMessages("42")) {
      results.push(msg);
    }
    expect(results).toHaveLength(1);
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("/projects/42/messages.json");
  });

  it("fetchComments uses correct message endpoint", async () => {
    const client = makeClient([{ body: [{ id: 7, content: "great" }], nextUrl: null }]);
    const fetcher = new Bc2Fetcher(client);
    const results: unknown[] = [];
    for await (const c of fetcher.fetchComments("42", "99")) {
      results.push(c);
    }
    expect((client.get as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "/projects/42/messages/99/comments.json"
    );
  });
});
```

- [x] **Step 2: Run to confirm they fail**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-fetcher.test.ts
```

Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement `lib/imports/bc2-fetcher.ts`**

```typescript
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
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-fetcher.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/imports/bc2-fetcher.ts tests/unit/bc2-fetcher.test.ts
git commit -m "feat: add BC2 fetcher with async generators and pagination"
```

---

## Task 5: BC2 Transformer — Title Parsing and Client Inference

**Files:**
- Create: `lib/imports/bc2-transformer.ts`
- Create: `tests/unit/bc2-transformer.test.ts`

### Context

BC2 project names encode client code, project number, and title in structured strings. The transformer parses these, looks up or creates clients, and produces the local schema shapes needed for insertion.

Regex rules (from spec):
- Primary: `/^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/` → `{ code, num, title }`
- Fallback: `/^([A-Za-z]+)\s*[-–]\s*(.+)$/` → `{ code, num: null, title }`
- Default: `{ code: null, num: null, title: rawName }`

Client lookup: match `clients.code` case-insensitively. If no match, create a new client with `code` as both `name` and `code`.

- [x] **Step 1: Write the failing tests**

```typescript
// tests/unit/bc2-transformer.test.ts
import { describe, it, expect } from "vitest";
import { parseProjectTitle } from "@/lib/imports/bc2-transformer";

describe("parseProjectTitle", () => {
  it("parses standard format with number", () => {
    const r = parseProjectTitle("Poms-1414: Purple Mushroom Package");
    expect(r).toEqual({ code: "Poms", num: "1414", title: "Purple Mushroom Package" });
  });

  it("parses four-digit codes", () => {
    const r = parseProjectTitle("JFLA-444: Invitation Graphic");
    expect(r).toEqual({ code: "JFLA", num: "444", title: "Invitation Graphic" });
  });

  it("parses format without number (hyphen dash)", () => {
    const r = parseProjectTitle("GX-Website Review");
    expect(r).toEqual({ code: "GX", num: null, title: "Website Review" });
  });

  it("parses format without number (spaced dash)", () => {
    const r = parseProjectTitle("POMS - Website Software Update");
    expect(r).toEqual({ code: "POMS", num: null, title: "Website Software Update" });
  });

  it("returns null code and num for unrecognized format", () => {
    const r = parseProjectTitle("Some random project name");
    expect(r).toEqual({ code: null, num: null, title: "Some random project name" });
  });

  it("strips whitespace from title", () => {
    const r = parseProjectTitle("ALG-100:  Spaced Title  ");
    expect(r).toEqual({ code: "ALG", num: "100", title: "Spaced Title" });
  });
});
```

- [x] **Step 2: Run to confirm they fail**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-transformer.test.ts
```

Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement the transformer (title parsing only first)**

```typescript
// lib/imports/bc2-transformer.ts
import { query } from "../db";

export interface ParsedProjectTitle {
  code: string | null;
  num: string | null;
  title: string;
}

const PRIMARY_PATTERN = /^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/;
const FALLBACK_PATTERN = /^([A-Za-z]+)\s*[-\u2013]\s*(.+)$/;

export function parseProjectTitle(raw: string): ParsedProjectTitle {
  const primaryMatch = raw.match(PRIMARY_PATTERN);
  if (primaryMatch) {
    return {
      code: primaryMatch[1],
      num: primaryMatch[2],
      title: primaryMatch[3].trim()
    };
  }

  const fallbackMatch = raw.match(FALLBACK_PATTERN);
  if (fallbackMatch) {
    return {
      code: fallbackMatch[1],
      num: null,
      title: fallbackMatch[2].trim()
    };
  }

  return { code: null, num: null, title: raw.trim() };
}

// Look up a client by code (case-insensitive) or create one.
// Returns the client id (uuid).
export async function resolveClientId(code: string): Promise<string> {
  const existing = await query(
    "select id from clients where lower(code) = lower($1) limit 1",
    [code]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id as string;
  }

  const created = await query(
    "insert into clients (name, code) values ($1, $2) returning id",
    [code, code]
  );
  return created.rows[0].id as string;
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-transformer.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/imports/bc2-transformer.ts tests/unit/bc2-transformer.test.ts
git commit -m "feat: add BC2 project title parser and client resolver"
```

---

## Task 6: BC2 Transformer — People Mapping (Legacy Profiles)

**Files:**
- Modify: `lib/imports/bc2-transformer.ts`
- Modify: `tests/unit/bc2-transformer.test.ts`

### Context

For each BC2 person: look up `user_profiles` by email. If found, use existing profile. If not, create a legacy profile with `id = 'bc2_{person_id}'`, `is_legacy = true`. Record either way in `import_map_people`.

- [x] **Step 1: Add failing tests for people resolution**

Append to `tests/unit/bc2-transformer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { resolvePerson } from "@/lib/imports/bc2-transformer";
import type { Bc2Person } from "@/lib/imports/bc2-fetcher";

vi.mock("@/lib/db", () => ({
  query: vi.fn()
}));

const mockQuery = db.query as ReturnType<typeof vi.fn>;

describe("resolvePerson", () => {
  const person: Bc2Person = {
    id: 42,
    name: "Alice Smith",
    email_address: "alice@example.com",
    avatar_url: null,
    title: "Designer",
    time_zone: "America/New_York"
  };

  beforeEach(() => mockQuery.mockReset());

  it("returns existing profile id when email matches", async () => {
    // 1st query: check import_map_people — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2nd query: lookup user_profiles by email — found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "existing-uuid" }] });
    // 3rd query: insert into import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("existing-uuid");
    expect(result.isLegacy).toBe(false);
  });

  it("creates legacy profile when no email match", async () => {
    // 1st query: check import_map_people — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2nd query: lookup user_profiles by email — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3rd query: insert legacy user_profile
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "bc2_42" }] });
    // 4th query: insert into import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("bc2_42");
    expect(result.isLegacy).toBe(true);
  });

  it("returns already-mapped profile without re-inserting", async () => {
    // 1st query: check import_map_people — found
    mockQuery.mockResolvedValueOnce({ rows: [{ local_user_profile_id: "cached-uuid" }] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("cached-uuid");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run to confirm new tests fail**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-transformer.test.ts
```

Expected: New tests FAIL (resolvePerson not exported).

- [x] **Step 3: Add `resolvePerson` to `lib/imports/bc2-transformer.ts`**

Append to `lib/imports/bc2-transformer.ts`:

```typescript
import type { Bc2Person } from "./bc2-fetcher";

export interface ResolvedPerson {
  localProfileId: string;
  isLegacy: boolean;
}

export async function resolvePerson(person: Bc2Person, jobId: string): Promise<ResolvedPerson> {
  // Check import map first (idempotency)
  const mapRow = await query(
    "select local_user_profile_id from import_map_people where basecamp_person_id = $1",
    [String(person.id)]
  );
  if (mapRow.rows[0]) {
    return { localProfileId: mapRow.rows[0].local_user_profile_id as string, isLegacy: false };
  }

  // Try to match by email
  const emailRow = await query(
    "select id from user_profiles where email = $1 limit 1",
    [person.email_address]
  );

  let localProfileId: string;
  let isLegacy: boolean;

  if (emailRow.rows[0]) {
    localProfileId = emailRow.rows[0].id as string;
    isLegacy = false;
  } else {
    // Create legacy profile
    const [firstName, ...restParts] = person.name.split(" ");
    const lastName = restParts.join(" ") || null;
    const legacyId = `bc2_${person.id}`;
    const created = await query(
      `insert into user_profiles
         (id, email, first_name, last_name, avatar_url, job_title, timezone, is_legacy)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (id) do nothing
       returning id`,
      [
        legacyId,
        person.email_address,
        firstName ?? null,
        lastName,
        person.avatar_url ?? null,
        person.title ?? null,
        person.time_zone ?? null
      ]
    );
    localProfileId = (created.rows[0]?.id as string) ?? legacyId;
    isLegacy = true;
  }

  // Record in import map
  await query(
    "insert into import_map_people (basecamp_person_id, local_user_profile_id) values ($1, $2) on conflict (basecamp_person_id) do nothing",
    [String(person.id), localProfileId]
  );

  return { localProfileId, isLegacy };
}
```

- [x] **Step 4: Run all transformer tests**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-transformer.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/imports/bc2-transformer.ts tests/unit/bc2-transformer.test.ts
git commit -m "feat: add BC2 person resolver with legacy profile creation"
```

---

## Task 7: CLI Script — Structure, Flags, and Job Creation

**Files:**
- Create: `scripts/migrate-bc2.ts`

### Context

The script is the CLI entry point. It parses flags, validates env vars, creates an `import_job`, and passes everything to the orchestrator. Run with: `npx tsx scripts/migrate-bc2.ts --mode=dry|limited|full`.

This task covers structure and the people + projects phases only. Threads/comments and files come in Tasks 8 and 9.

- [x] **Step 1: Create `scripts/migrate-bc2.ts` with flag parsing and job setup**

```typescript
#!/usr/bin/env npx tsx
// scripts/migrate-bc2.ts

import { query } from "../lib/db";
import { Bc2Client } from "../lib/imports/bc2-client";
import { Bc2Fetcher } from "../lib/imports/bc2-fetcher";
import {
  parseProjectTitle,
  resolveClientId,
  resolvePerson
} from "../lib/imports/bc2-transformer";

// ── CLI flags ─────────────────────────────────────────────────────────────────

type RunMode = "dry" | "limited" | "full";

interface CliFlags {
  mode: RunMode;
  limit: number;
  files: boolean;
  fromProject: string | null;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find(a => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=")[1] : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);

  const rawMode = get("mode") ?? "full";
  if (!["dry", "limited", "full"].includes(rawMode)) {
    console.error(`Unknown --mode=${rawMode}. Use dry | limited | full.`);
    process.exit(1);
  }

  return {
    mode: rawMode as RunMode,
    limit: parseInt(get("limit") ?? "5", 10),
    files: has("files"),
    fromProject: get("from-project")
  };
}

// ── Env validation ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// ── Import job helpers ────────────────────────────────────────────────────────

async function createMigrationJob(options: object): Promise<string> {
  const result = await query(
    "insert into import_jobs (status, options) values ('running', $1) returning id",
    [JSON.stringify(options)]
  );
  return result.rows[0].id as string;
}

async function logRecord(
  jobId: string,
  recordType: string,
  sourceId: string,
  status: "success" | "failed",
  message?: string
) {
  await query(
    "insert into import_logs (job_id, record_type, source_record_id, status, message) values ($1,$2,$3,$4,$5)",
    [jobId, recordType, sourceId, status, message ?? null]
  );
}

async function incrementCounters(jobId: string, success: number, failed: number) {
  await query(
    `update import_jobs set
       success_count = success_count + $2,
       failed_count  = failed_count  + $3,
       total_records = total_records + $2 + $3
     where id = $1`,
    [jobId, success, failed]
  );
}

async function finishJob(jobId: string, status: "completed" | "failed" | "interrupted") {
  await query(
    "update import_jobs set status=$2, finished_at=now() where id=$1",
    [jobId, status]
  );
}

// ── Progress output ───────────────────────────────────────────────────────────

function pad(n: number, total: number): string {
  const width = String(total).length;
  return String(n).padStart(width, " ");
}

// ── People phase ──────────────────────────────────────────────────────────────

async function migratePeople(
  jobId: string,
  fetcher: Bc2Fetcher,
  mode: RunMode
): Promise<Map<number, string>> {
  const personMap = new Map<number, string>(); // bc2 id → local profile id
  process.stdout.write("Resolving people...\n");

  for await (const person of fetcher.fetchPeople()) {
    try {
      if (mode !== "dry") {
        const resolved = await resolvePerson(person, jobId);
        personMap.set(person.id, resolved.localProfileId);
        await logRecord(jobId, "person", String(person.id), "success");
        await incrementCounters(jobId, 1, 0);
      } else {
        personMap.set(person.id, `dry_${person.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  person ${person.id} FAILED: ${msg}\n`);
      if (mode !== "dry") {
        await logRecord(jobId, "person", String(person.id), "failed", msg);
        await incrementCounters(jobId, 0, 1);
      }
    }
  }

  process.stdout.write(`  ${personMap.size} people resolved\n`);
  return personMap;
}

// ── Projects phase ────────────────────────────────────────────────────────────

interface MigratedProject {
  bc2Id: number;
  localId: string;
  name: string;
}

async function migrateProjects(
  jobId: string,
  fetcher: Bc2Fetcher,
  personMap: Map<number, string>,
  flags: CliFlags
): Promise<MigratedProject[]> {
  const projects: MigratedProject[] = [];
  process.stdout.write("Fetching projects...\n");

  let count = 0;
  for await (const bc2Project of fetcher.fetchProjects()) {
    if (flags.mode === "limited" && count >= flags.limit) break;
    if (flags.fromProject && !bc2Project.name.startsWith(flags.fromProject)) {
      continue;
    }

    count++;
    try {
      if (flags.mode === "dry") {
        projects.push({ bc2Id: bc2Project.id, localId: `dry_${bc2Project.id}`, name: bc2Project.name });
        continue;
      }

      // Idempotency: check map
      const existing = await query(
        "select local_project_id from import_map_projects where basecamp_project_id = $1",
        [String(bc2Project.id)]
      );
      if (existing.rows[0]) {
        projects.push({ bc2Id: bc2Project.id, localId: existing.rows[0].local_project_id as string, name: bc2Project.name });
        await logRecord(jobId, "project", String(bc2Project.id), "success", "Already mapped");
        await incrementCounters(jobId, 1, 0);
        continue;
      }

      const { code, num, title } = parseProjectTitle(bc2Project.name);
      const clientId = code ? await resolveClientId(code) : null;

      // Build canonical project identity
      // Format expected by existing schema: CLIENTCODE-0000-slug (best-effort from BC2 data)
      const projectNumber = num ? num.padStart(4, "0") : "0000";
      const projectCode = code ? `${code.toUpperCase()}-${projectNumber}` : `BC2-${bc2Project.id}`;

      const created = await query(
        `insert into projects (name, description, client_id, archived, code)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [
          title,
          bc2Project.description ?? null,
          clientId,
          bc2Project.archived,
          projectCode
        ]
      );
      const localId = created.rows[0].id as string;

      await query(
        "insert into import_map_projects (basecamp_project_id, local_project_id) values ($1,$2)",
        [String(bc2Project.id), localId]
      );
      await logRecord(jobId, "project", String(bc2Project.id), "success");
      await incrementCounters(jobId, 1, 0);
      projects.push({ bc2Id: bc2Project.id, localId, name: bc2Project.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  project ${bc2Project.id} (${bc2Project.name}) FAILED: ${msg}\n`);
      await logRecord(jobId, "project", String(bc2Project.id), "failed", msg);
      await incrementCounters(jobId, 0, 1);
    }
  }

  process.stdout.write(`  ${projects.length} projects resolved\n`);
  return projects;
}

// ── Main (stub for now — threads/comments/files added in Tasks 8-9) ───────────

async function main() {
  const flags = parseFlags();

  const accountId  = requireEnv("BC2_ACCOUNT_ID");
  const accessToken = requireEnv("BC2_ACCESS_TOKEN");
  const userAgent  = requireEnv("BC2_USER_AGENT");
  const delayMs    = parseInt(process.env.BC2_REQUEST_DELAY_MS ?? "200", 10);

  const client  = new Bc2Client({ accountId, accessToken, userAgent, requestDelayMs: delayMs });
  const fetcher = new Bc2Fetcher(client);

  const modeLabel = flags.mode === "dry" ? " (dry)" : flags.mode === "limited" ? ` (limited: ${flags.limit})` : "";
  console.log(`[BC2 Migration] mode=${flags.mode}${modeLabel}`);

  const jobId = flags.mode !== "dry"
    ? await createMigrationJob({ mode: flags.mode, limit: flags.limit, files: flags.files })
    : "dry-run";

  // SIGINT: mark job interrupted and exit
  process.on("SIGINT", async () => {
    console.log("\n[Interrupted — marking job as interrupted]");
    if (jobId !== "dry-run") {
      await finishJob(jobId, "interrupted").catch(() => {});
    }
    process.exit(0);
  });

  const personMap = await migratePeople(jobId, fetcher, flags.mode);
  const projects   = await migrateProjects(jobId, fetcher, personMap, flags);

  // Tasks 8-9 will call migrateThreads, migrateComments, migrateFiles here

  if (jobId !== "dry-run") {
    await finishJob(jobId, "completed");
  }
  console.log(`\nDone — ${projects.length} projects processed (job_id=${jobId})`);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
```

- [x] **Step 2: Run the script in dry mode (validate it starts up)**

```bash
BC2_ACCOUNT_ID=test BC2_ACCESS_TOKEN=test BC2_USER_AGENT="Test (test@test.com)" \
  npx tsx scripts/migrate-bc2.ts --mode=dry 2>&1 | head -5
```

Expected: It starts but fails when trying to fetch from BC2 (no real credentials) — that's fine. The goal is it compiles and parses flags without crashing before the network call.

- [x] **Step 3: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat: add BC2 migration script with flag parsing, job creation, people + projects phases"
```

---

## Task 8: CLI Script — Threads and Comments Phase

**Files:**
- Modify: `scripts/migrate-bc2.ts`

### Context

For each project, fetch all messages (threads) and their comments. Insert into `discussion_threads` / `discussion_comments` via existing repository functions. Map via `import_map_threads` / `import_map_comments`.

- [x] **Step 1: Add `migrateThreadsAndComments` function and wire it into `main`**

Add the following function before `main()` in `scripts/migrate-bc2.ts`:

```typescript
import { createThread, createComment } from "../lib/repositories";

async function migrateThreadsAndComments(
  jobId: string,
  fetcher: Bc2Fetcher,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode
): Promise<{ threadCount: number; commentCount: number }> {
  let threadCount = 0;
  let commentCount = 0;
  const total = projects.length;

  for (let i = 0; i < projects.length; i++) {
    const proj = projects[i];
    let projThreads = 0;
    let projComments = 0;

    for await (const msg of fetcher.fetchMessages(String(proj.bc2Id))) {
      try {
        let localThreadId: string;

        if (mode === "dry") {
          localThreadId = `dry_thread_${msg.id}`;
        } else {
          const existingThread = await query(
            "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
            [String(msg.id)]
          );
          if (existingThread.rows[0]) {
            localThreadId = existingThread.rows[0].local_thread_id as string;
          } else {
            const authorId = personMap.get(msg.creator.id) ?? personMap.values().next().value ?? "unknown";
            const thread = await createThread({
              projectId: proj.localId,
              title: msg.subject,
              bodyMarkdown: msg.content,
              authorUserId: authorId
            });
            localThreadId = thread.id as string;
            await query(
              "insert into import_map_threads (basecamp_thread_id, local_thread_id) values ($1,$2)",
              [String(msg.id), localThreadId]
            );
            await logRecord(jobId, "thread", String(msg.id), "success");
            await incrementCounters(jobId, 1, 0);
          }
        }

        projThreads++;
        threadCount++;

        // Comments for this message
        for await (const comment of fetcher.fetchComments(String(proj.bc2Id), String(msg.id))) {
          try {
            if (mode !== "dry") {
              const existingComment = await query(
                "select local_comment_id from import_map_comments where basecamp_comment_id = $1",
                [String(comment.id)]
              );
              if (!existingComment.rows[0]) {
                const authorId = personMap.get(comment.creator.id) ?? "unknown";
                const created = await createComment({
                  projectId: proj.localId,
                  threadId: localThreadId,
                  bodyMarkdown: comment.content,
                  authorUserId: authorId
                });
                await query(
                  "insert into import_map_comments (basecamp_comment_id, local_comment_id) values ($1,$2)",
                  [String(comment.id), created.id]
                );
                await logRecord(jobId, "comment", String(comment.id), "success");
                await incrementCounters(jobId, 1, 0);
              }
            }
            projComments++;
            commentCount++;
          } catch (err) {
            const msg2 = err instanceof Error ? err.message : String(err);
            if (mode !== "dry") {
              await logRecord(jobId, "comment", String(comment.id), "failed", msg2);
              await incrementCounters(jobId, 0, 1);
            }
          }
        }
      } catch (err) {
        const msg2 = err instanceof Error ? err.message : String(err);
        if (mode !== "dry") {
          await logRecord(jobId, "thread", String(msg.id), "failed", msg2);
          await incrementCounters(jobId, 0, 1);
        }
      }
    }

    const dryMark = mode === "dry" ? " (dry)" : "";
    process.stdout.write(
      `[${pad(i + 1, total)}/${total}] ${proj.name.slice(0, 20).padEnd(20)}  ${projThreads} threads  ${projComments} comments${dryMark}\n`
    );
  }

  return { threadCount, commentCount };
}
```

Then inside `main()`, replace the comment stub line with:

```typescript
  const { threadCount, commentCount } = await migrateThreadsAndComments(
    jobId, fetcher, projects, personMap, flags.mode
  );
```

Update the final console.log to:

```typescript
  console.log(
    `\nDone — ${projects.length} projects, ${threadCount} threads, ${commentCount} comments (job_id=${jobId})`
  );
```

- [x] **Step 2: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat: add threads and comments migration phase to BC2 script"
```

---

## Task 9: CLI Script — Files Phase, Progress, and Final Wiring

**Files:**
- Modify: `scripts/migrate-bc2.ts`

### Context

The files phase downloads from BC2 and uploads to Dropbox using the existing upload protocol. Files are skipped in `limited` mode unless `--files` is passed. Concurrency capped at 3 with per-file retry (up to 3 attempts). Inline attachments on threads/comments get `thread_id`/`comment_id` set.

Look up how files are uploaded in the existing `lib/imports/basecamp2-import.ts` + `lib/repositories.ts` — reuse those patterns. The existing `createFileMetadata` function signature:

```typescript
createFileMetadata({
  projectId: string,
  uploaderUserId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  checksum: string,
  dropboxFileId: string,
  dropboxPath: string
})
```

For BC2 file downloads, use the attachment `url` field with the same auth headers as `Bc2Client.get()`.

- [x] **Step 1: Add `migrateFiles` function to `scripts/migrate-bc2.ts`**

Add before `main()`:

```typescript
import { createFileMetadata } from "../lib/repositories";
import { uploadToDropbox, getDropboxStorageDir } from "../lib/dropbox"; // adjust import path to match actual exports

async function uploadWithRetry(
  fetcher: Bc2Fetcher,
  attachment: import("../lib/imports/bc2-fetcher").Bc2Attachment,
  projectId: string,
  uploaderUserId: string,
  dropboxDir: string,
  maxAttempts = 3
): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Download from BC2 (url is pre-signed, no auth needed for direct asset URLs)
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`BC2 download failed: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const dropboxPath = `${dropboxDir}/${attachment.filename}`;
      const { fileId } = await uploadToDropbox(buffer, dropboxPath);
      return fileId;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr!;
}

async function migrateFiles(
  jobId: string,
  fetcher: Bc2Fetcher,
  projects: MigratedProject[],
  personMap: Map<number, string>,
  mode: RunMode,
  includeFiles: boolean
): Promise<number> {
  if (!includeFiles || mode === "dry") {
    if (mode === "dry") process.stdout.write("Files: skipped in dry mode\n");
    else process.stdout.write("Files: skipped (pass --files to include)\n");
    return 0;
  }

  let fileCount = 0;
  const CONCURRENCY = 3;

  for (const proj of projects) {
    const uploaderUserId = personMap.values().next().value ?? "unknown";
    const dropboxDir = await getDropboxStorageDir(proj.localId);
    const queue: Array<() => Promise<void>> = [];

    for await (const attachment of fetcher.fetchAttachments(String(proj.bc2Id))) {
      queue.push(async () => {
        try {
          const existingMap = await query(
            "select local_file_id from import_map_files where basecamp_file_id = $1",
            [String(attachment.id)]
          );
          if (existingMap.rows[0]) return;

          const dropboxFileId = await uploadWithRetry(
            fetcher, attachment, proj.localId, uploaderUserId, dropboxDir
          );

          const fileRecord = await createFileMetadata({
            projectId: proj.localId,
            uploaderUserId,
            filename: attachment.filename,
            mimeType: attachment.content_type,
            sizeBytes: attachment.byte_size,
            checksum: "",
            dropboxFileId,
            dropboxPath: `${dropboxDir}/${attachment.filename}`
          });

          await query(
            "insert into import_map_files (basecamp_file_id, local_file_id) values ($1,$2)",
            [String(attachment.id), fileRecord.id]
          );
          await logRecord(jobId, "file", String(attachment.id), "success");
          await incrementCounters(jobId, 1, 0);
          fileCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logRecord(jobId, "file", String(attachment.id), "failed", msg);
          await incrementCounters(jobId, 0, 1);
        }
      });
    }

    // Run with concurrency cap
    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY);
      await Promise.all(batch.map(fn => fn()));
    }
  }

  return fileCount;
}
```

- [x] **Step 2: Wire `migrateFiles` into `main()`**

In `main()`, after the threads/comments call, add:

```typescript
  const fileCount = await migrateFiles(
    jobId, fetcher, projects, personMap, flags.mode, flags.files
  );
```

Update the final `console.log` line to:

```typescript
  console.log(
    `\nDone — ${projects.length} projects, ${threadCount} threads, ${commentCount} comments, ${fileCount} files (job_id=${jobId})`
  );
```

- [x] **Step 3: Verify the script compiles cleanly**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Fix any type errors before proceeding. Common issues: missing Dropbox import paths (check what `lib/dropbox.ts` actually exports using grep).

- [x] **Step 4: Smoke-test in dry mode**

```bash
BC2_ACCOUNT_ID=test BC2_ACCESS_TOKEN=test BC2_USER_AGENT="Test (test@test.com)" \
  npx tsx scripts/migrate-bc2.ts --mode=dry 2>&1
```

Expected: Script starts, tries to fetch people from BC2, then fails with a network/auth error (expected — no real credentials). The goal is clean flag parsing and compilation.

- [x] **Step 5: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat: complete BC2 migration script with files phase, concurrency, SIGINT, and dry mode"
```

---

## Task 10: Legacy Profile Reconciliation on First Google Login

**Files:**
- Modify: whichever file calls `createUserProfile` after Google OAuth succeeds (search with: `grep -r "createUserProfile" app/ lib/`)

### Context

The spec requires: after Google UID is confirmed, check for a `user_profiles` row with matching email and `is_legacy = true`. If found: update `id` → Google UID, set `is_legacy = false`, update `import_map_people`.

This is a **minor, targeted addition** — do not refactor the auth flow around it.

- [x] **Step 1: Find the first-login profile creation location**

```bash
grep -rn "createUserProfile" app/ lib/
```

Note the file(s) returned and read the relevant section before making changes.

- [x] **Step 2: Write failing test for legacy reconciliation**

In the test file for that auth module (or create `tests/unit/bc2-legacy-reconcile.test.ts`):

```typescript
// tests/unit/bc2-legacy-reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { reconcileLegacyProfile } from "@/lib/imports/bc2-transformer";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
const mockQuery = db.query as ReturnType<typeof vi.fn>;

describe("reconcileLegacyProfile", () => {
  beforeEach(() => mockQuery.mockReset());

  it("updates legacy profile id and clears is_legacy flag", async () => {
    // Legacy profile found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "bc2_42" }] });
    // Update user_profiles id
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Update import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileLegacyProfile("alice@example.com", "google-uid-abc");
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain("update user_profiles");
    expect(updateCall[1]).toContain("google-uid-abc");
  });

  it("returns false when no legacy profile found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await reconcileLegacyProfile("new@example.com", "google-uid-xyz");
    expect(result).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 3: Run to confirm tests fail**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-legacy-reconcile.test.ts
```

Expected: FAIL (reconcileLegacyProfile not exported)

- [x] **Step 4: Add `reconcileLegacyProfile` to `lib/imports/bc2-transformer.ts`**

Append to `lib/imports/bc2-transformer.ts`:

```typescript
// Returns true if a legacy profile was found and reconciled.
export async function reconcileLegacyProfile(
  email: string,
  googleUid: string
): Promise<boolean> {
  const legacyRow = await query(
    "select id from user_profiles where email = $1 and is_legacy = true limit 1",
    [email]
  );
  if (!legacyRow.rows[0]) return false;

  const oldId = legacyRow.rows[0].id as string;

  // Update the profile: new id = Google UID, clear legacy flag
  await query(
    "update user_profiles set id = $1, is_legacy = false, updated_at = now() where id = $2",
    [googleUid, oldId]
  );

  // Update import_map_people to point to the new id
  await query(
    "update import_map_people set local_user_profile_id = $1 where local_user_profile_id = $2",
    [googleUid, oldId]
  );

  return true;
}
```

- [x] **Step 5: Call `reconcileLegacyProfile` in the first-login path**

In the file identified in Step 1, after the Google UID is confirmed and `createUserProfile` is called, add:

```typescript
import { reconcileLegacyProfile } from "@/lib/imports/bc2-transformer";

// After confirming the Google UID and email:
await reconcileLegacyProfile(userEmail, googleUid);
// (createUserProfile call follows as before)
```

The call should be best-effort — wrap in try/catch if the surrounding code uses best-effort patterns, or let it throw if the surrounding code handles errors.

- [x] **Step 6: Run tests**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/unit/bc2-legacy-reconcile.test.ts
```

Expected: All tests pass.

- [x] **Step 7: Commit**

```bash
git add lib/imports/bc2-transformer.ts tests/unit/bc2-legacy-reconcile.test.ts
git add app/ lib/  # include whichever auth file was modified
git commit -m "feat: reconcile BC2 legacy profiles on first Google login"
```

---

## Task 11: Integration Test — Smoke and Idempotency

**Files:**
- Create: `tests/integration/bc2-migrate.test.ts`

### Context

This integration test runs against a real (test-branch) database. It mocks the BC2 HTTP layer (no real API calls) but uses real `query()` calls against the DB. It validates: (1) clean run creates expected rows, (2) re-run is idempotent (no duplicates).

- [x] **Step 1: Write the test**

```typescript
// tests/integration/bc2-migrate.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { query } from "@/lib/db";
import { resolvePerson, parseProjectTitle, resolveClientId } from "@/lib/imports/bc2-transformer";
import type { Bc2Person } from "@/lib/imports/bc2-fetcher";

// These tests hit the real DB — requires DATABASE_URL in env
const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("BC2 migration integration", () => {
  const testPersonId = 999991;
  const testEmail = `bc2test_${Date.now()}@example.com`;
  const testPerson: Bc2Person = {
    id: testPersonId,
    name: "Test Legacy User",
    email_address: testEmail,
    avatar_url: null,
    title: "QA",
    time_zone: "UTC"
  };

  afterAll(async () => {
    // Cleanup
    await query("delete from import_map_people where basecamp_person_id = $1", [String(testPersonId)]);
    await query("delete from user_profiles where email = $1", [testEmail]);
  });

  it("creates a legacy profile for an unknown BC2 person", async () => {
    const result = await resolvePerson(testPerson, "test-job");
    expect(result.localProfileId).toBe(`bc2_${testPersonId}`);
    expect(result.isLegacy).toBe(true);

    const profile = await query("select * from user_profiles where id = $1", [`bc2_${testPersonId}`]);
    expect(profile.rows[0]).toBeDefined();
    expect(profile.rows[0].is_legacy).toBe(true);
    expect(profile.rows[0].email).toBe(testEmail);
  });

  it("is idempotent: re-running resolvePerson returns same id without duplicates", async () => {
    const result = await resolvePerson(testPerson, "test-job");
    expect(result.localProfileId).toBe(`bc2_${testPersonId}`);

    const profileRows = await query("select id from user_profiles where email = $1", [testEmail]);
    expect(profileRows.rows).toHaveLength(1);

    const mapRows = await query(
      "select * from import_map_people where basecamp_person_id = $1",
      [String(testPersonId)]
    );
    expect(mapRows.rows).toHaveLength(1);
  });

  it("resolves project title and finds/creates client", async () => {
    const testCode = `BCTST${Date.now().toString().slice(-4)}`;
    const { code, num, title } = parseProjectTitle(`${testCode}-0042: Test Project Alpha`);
    expect(code).toBe(testCode);
    expect(num).toBe("0042");
    expect(title).toBe("Test Project Alpha");

    const clientId = await resolveClientId(testCode);
    expect(typeof clientId).toBe("string");

    // Idempotency: resolving again returns same id
    const clientId2 = await resolveClientId(testCode);
    expect(clientId2).toBe(clientId);

    // Cleanup
    await query("delete from clients where code = $1", [testCode]);
  });
});
```

- [x] **Step 2: Run the integration test (requires DATABASE_URL)**

```bash
TMPDIR=/tmp/codex-vitest npm run test -- tests/integration/bc2-migrate.test.ts
```

Expected: All tests pass. If DATABASE_URL is not set, tests are skipped (not failed).

- [x] **Step 3: Run all tests to confirm no regressions**

```bash
TMPDIR=/tmp/codex-vitest npm run test
```

Expected: All previously passing tests still pass.

- [x] **Step 4: Commit**

```bash
git add tests/integration/bc2-migrate.test.ts
git commit -m "test: add BC2 migration integration smoke and idempotency tests"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] BC2 HTTP client (auth, pagination, backoff) → Task 3
- [x] Async generators for all resource types → Task 4
- [x] Project title parsing (both regex patterns) → Task 5
- [x] Client lookup / auto-create → Task 5
- [x] People → legacy profile resolution → Task 6
- [x] CLI flags (`--mode`, `--limit`, `--files`, `--from-project`) → Task 7
- [x] Import job creation and SIGINT handling → Task 7
- [x] People migration phase → Task 7
- [x] Projects migration phase → Task 7
- [x] Threads + comments phase → Task 8
- [x] Files phase with concurrency cap of 3 → Task 9
- [x] Dry mode (no DB writes) → Tasks 7-9
- [x] Limited mode with `--limit` → Task 7
- [x] Progress output (one line per project) → Task 8
- [x] Legacy profile reconciliation on first login → Task 10
- [x] Database migration (0014, not 0012) → Task 1
- [x] Environment variables in .env.example → Task 2
- [x] Idempotency via import_map tables → All phases + Task 11

**Note on Dropbox uploads (Task 9):** The exact function names for Dropbox upload (`uploadToDropbox`, `getDropboxStorageDir`) are placeholders. Before implementing Task 9, run `grep -rn "export.*function" lib/dropbox*.ts lib/storage*.ts` to find the actual export names.

**Note on `projects.code` column:** The script inserts into `projects.code`. Verify this column exists with `grep -r "code" supabase/migrations/0005_project_identity_and_storage.sql`. If the column name differs, adjust the insert query in Task 7 accordingly.
