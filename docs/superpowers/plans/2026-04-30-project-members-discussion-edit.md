# Project Members + Discussion Edit + Discussion Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `project_members` to scope notifications, allow thread authors to edit their threads, and support attachments on the create-discussion form.

**Architecture:** Postgres migration adds `project_members` table and `threads.edited_at`. New repo helpers replace `listNotificationRecipients` with project-scoped variants. Three new API surfaces (members CRUD, active users, PATCH thread). UI changes to `ProjectDialogForm`, `CreateDiscussionDialog`, and the discussion page. Composer attachment pipeline is extracted into a reusable hook.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, Supabase auth, raw `pg` via `lib/repositories.ts`, Vitest + RTL, Mailgun via `lib/mailer.ts`, Dropbox temp upload link for attachments.

**Spec:** `docs/superpowers/specs/2026-04-30-project-members-discussion-edit-design.md`.

**Pre-deploy rule (project-wide):** Take a verified database backup before applying any migration in any environment. This rule applies to PR1's migration and any follow-up schema migration in this plan.

---

## PR1 — Schema and Repository

### Task 1.0: Pre-flight backup checklist (manual, not committed)

This task is operational. It does not produce code; it gates merge.

- [ ] **Step 1: Take a backup of the dev database.**

```bash
# Adjust to current pg connection details. Output goes to a timestamped file.
pg_dump "$DATABASE_URL" > "backups/dev-$(date +%Y%m%d-%H%M%S).sql"
```

- [ ] **Step 2: Verify the backup is restorable on a scratch database.**

```bash
createdb pm_restore_check
psql pm_restore_check < backups/dev-<timestamp>.sql
psql pm_restore_check -c "select count(*) from projects;"
dropdb pm_restore_check
```
Expected: project count matches the live dev database.

- [ ] **Step 3: Document the backup file path in the PR description before merge to `main`.**

The same backup discipline is repeated for staging and prod promotions.

---

### Task 1.1: Add migration `0026_project_members.sql`

**Files:**
- Create: `supabase/migrations/0026_project_members.sql`

- [ ] **Step 1: Write the migration.**

```sql
-- 0026_project_members.sql
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id text not null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_members_user_id on project_members(user_id);

alter table threads add column if not exists edited_at timestamptz;

with active_projects as (
  select p.id, p.created_by
  from projects p
  join clients c on c.id = p.client_id
  where p.archived = false and c.archived_at is null
)
insert into project_members (project_id, user_id)
select id, created_by from active_projects
union
select t.project_id, t.author_user_id
  from threads t
  join active_projects ap on ap.id = t.project_id
union
select t.project_id, c.author_user_id
  from comments c
  join threads t on t.id = c.thread_id
  join active_projects ap on ap.id = t.project_id
on conflict do nothing;
```

- [ ] **Step 2: Verify the comment-to-thread join column.**

Run:
```bash
psql "$DATABASE_URL" -c "\d comments"
```
Expected: a column linking comments to threads. If the column is named `thread_id` the migration is correct as written. If it's named differently (e.g., `discussion_id`), update the join in the backfill and re-save the migration.

- [ ] **Step 3: Apply migration locally.**

```bash
psql "$DATABASE_URL" -f supabase/migrations/0026_project_members.sql
```
Expected: no errors. `\d project_members` shows the table with two-column PK.

- [ ] **Step 4: Spot-check the backfill.**

```bash
psql "$DATABASE_URL" -c "select count(*) from project_members;"
psql "$DATABASE_URL" -c "
  select count(*) from project_members pm
  join projects p on p.id = pm.project_id
  where p.archived = true;
"
```
Expected: total > 0. Archived-project member count = 0.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/0026_project_members.sql
git commit -m "feat(db): project_members table, threads.edited_at, active backfill"
```

---

### Task 1.2: Add `addProjectMember` repo helper (TDD)

**Files:**
- Create: `tests/unit/project-members-repo.test.ts`
- Modify: `lib/repositories.ts` (append to file)

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/project-members-repo.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("addProjectMember", () => {
  it("inserts a (project_id, user_id) row idempotently", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { addProjectMember } = await import("@/lib/repositories");
    await addProjectMember("p1", "u1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/insert into project_members.*on conflict do nothing/is),
      ["p1", "u1"]
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run tests/unit/project-members-repo.test.ts`
Expected: FAIL — `addProjectMember` is not exported.

- [ ] **Step 3: Implement.**

Append to `lib/repositories.ts`:

```ts
export async function addProjectMember(projectId: string, userId: string) {
  await query(
    "insert into project_members (project_id, user_id) values ($1, $2) on conflict do nothing",
    [projectId, userId]
  );
}
```

(Use the exact `query` import that other helpers in the file already use; if the file uses `pool.query`, mirror that.)

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run tests/unit/project-members-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-repo.test.ts lib/repositories.ts
git commit -m "feat(repo): addProjectMember idempotent insert"
```

---

### Task 1.3: Add `removeProjectMember` with last-member guard (TDD)

**Files:**
- Modify: `tests/unit/project-members-repo.test.ts`
- Modify: `lib/repositories.ts`

- [ ] **Step 1: Write the failing tests.**

Append to `tests/unit/project-members-repo.test.ts`:

```ts
describe("removeProjectMember", () => {
  it("deletes when more than one member remains", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: "2" }] }); // count
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // delete
    const { removeProjectMember } = await import("@/lib/repositories");
    await removeProjectMember("p1", "u1");
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/delete from project_members/i),
      ["p1", "u1"]
    );
  });

  it("throws when removing would leave zero members", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    const { removeProjectMember } = await import("@/lib/repositories");
    await expect(removeProjectMember("p1", "u1")).rejects.toThrow(
      /last member/i
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run tests/unit/project-members-repo.test.ts`
Expected: FAIL — `removeProjectMember` not exported.

- [ ] **Step 3: Implement.**

Append to `lib/repositories.ts`:

```ts
export async function removeProjectMember(projectId: string, userId: string) {
  const countResult = await query(
    "select count(*)::int as count from project_members where project_id = $1",
    [projectId]
  );
  const current = Number(countResult.rows[0]?.count ?? 0);
  if (current <= 1) {
    throw new Error("Cannot remove the last member of a project");
  }
  await query(
    "delete from project_members where project_id = $1 and user_id = $2",
    [projectId, userId]
  );
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/unit/project-members-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-repo.test.ts lib/repositories.ts
git commit -m "feat(repo): removeProjectMember with last-member guard"
```

---

### Task 1.4: Add `listProjectMembers` (TDD)

**Files:**
- Modify: `tests/unit/project-members-repo.test.ts`
- Modify: `lib/repositories.ts`

- [ ] **Step 1: Write the failing test.**

```ts
describe("listProjectMembers", () => {
  it("returns members joined with user_profiles, ordered by added_at", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          user_id: "u1",
          email: "a@x.com",
          first_name: "Alex",
          last_name: "A",
          added_at: new Date("2026-04-30T00:00:00Z")
        }
      ]
    });
    const { listProjectMembers } = await import("@/lib/repositories");
    const result = await listProjectMembers("p1");
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("a@x.com");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/from project_members.*join user_profiles/is),
      ["p1"]
    );
  });
});
```

- [ ] **Step 2: Run test.**

Run: `npx vitest run tests/unit/project-members-repo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

Append to `lib/repositories.ts`:

```ts
export type ProjectMember = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  added_at: Date;
};

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const result = await query(
    `select pm.user_id, up.email, up.first_name, up.last_name, pm.added_at
       from project_members pm
       join user_profiles up on up.id = pm.user_id
      where pm.project_id = $1
      order by pm.added_at asc`,
    [projectId]
  );
  return result.rows.map((row: ProjectMember) => ({
    user_id: row.user_id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    added_at: row.added_at
  }));
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-repo.test.ts lib/repositories.ts
git commit -m "feat(repo): listProjectMembers"
```

---

### Task 1.5: Add `listProjectMemberRecipients` (TDD)

**Files:**
- Modify: `tests/unit/project-members-repo.test.ts`
- Modify: `lib/repositories.ts`

- [ ] **Step 1: Write the failing test.**

```ts
describe("listProjectMemberRecipients", () => {
  it("excludes the actor and legacy users; returns email-shaped rows", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "u2", email: "b@x.com", first_name: "Bee", last_name: null }
      ]
    });
    const { listProjectMemberRecipients } = await import("@/lib/repositories");
    const recipients = await listProjectMemberRecipients("p1", "u1");
    expect(recipients).toEqual([
      { id: "u2", email: "b@x.com", firstName: "Bee", lastName: null }
    ]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/from project_members/i);
    expect(sql).toMatch(/up\.is_legacy = false/i);
    expect(sql).toMatch(/pm\.user_id <> \$2/i);
    expect(params).toEqual(["p1", "u1"]);
  });
});
```

- [ ] **Step 2: Run test.** Expected: FAIL.

- [ ] **Step 3: Implement.**

Append to `lib/repositories.ts`:

```ts
export type NotificationRecipientRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export async function listProjectMemberRecipients(
  projectId: string,
  excludeUserId: string
): Promise<NotificationRecipientRow[]> {
  const result = await query(
    `select up.id, up.email, up.first_name, up.last_name
       from project_members pm
       join user_profiles up on up.id = pm.user_id
      where pm.project_id = $1
        and pm.user_id <> $2
        and up.is_legacy = false
        and up.email is not null`,
    [projectId, excludeUserId]
  );
  return result.rows.map((row: { id: string; email: string; first_name: string | null; last_name: string | null }) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name
  }));
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-repo.test.ts lib/repositories.ts
git commit -m "feat(repo): listProjectMemberRecipients excludes actor and legacy users"
```

---

### Task 1.6: Insert creator into `project_members` on project create (TDD)

**Files:**
- Modify: `tests/unit/create-project.test.ts`
- Modify: `lib/repositories.ts` (function `createProject`)

- [ ] **Step 1: Add a failing test to `tests/unit/create-project.test.ts`.**

```ts
it("inserts the creator into project_members in the same call path", async () => {
  // Arrange repository test as already structured. After createProject,
  // expect the addProjectMember query to have run with the new project id
  // and createdBy.
  // ...harness already mocks `query`; assert the second call inserts into project_members.
  expect(queryMock).toHaveBeenCalledWith(
    expect.stringMatching(/insert into project_members.*on conflict do nothing/is),
    [createdProjectId, "user-creator"]
  );
});
```

(Adapt to the existing test's mock harness conventions — read the file first.)

- [ ] **Step 2: Run test.** Expected: FAIL.

- [ ] **Step 3: Implement.**

In `lib/repositories.ts`, locate `createProject`. After the project insert succeeds and inside the same transaction (or immediately following, if `createProject` doesn't use a transaction), call `addProjectMember(createdProject.id, args.createdBy)`.

```ts
// inside createProject, after the row is inserted:
await addProjectMember(createdProject.id, args.createdBy);
return createdProject;
```

If `createProject` already opens a client/transaction, run the insert on that client instead of calling the helper, to keep it atomic.

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/unit/create-project.test.ts tests/unit/project-members-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/create-project.test.ts lib/repositories.ts
git commit -m "feat(repo): auto-add creator to project_members on createProject"
```

---

### Task 1.7: Open PR1

- [ ] **Step 1: Push branch and open PR.**

```bash
git push -u origin <branch>
gh pr create --title "feat(db): project_members table + repo helpers" --body "$(cat <<'EOF'
## Summary
- Adds `project_members` table, `threads.edited_at`, and active-project backfill (migration 0026).
- New repo helpers: `addProjectMember`, `removeProjectMember`, `listProjectMembers`, `listProjectMemberRecipients`.
- `createProject` now auto-adds the creator into `project_members`.

## Pre-deploy
- DB backup taken at `<path>` and verified restorable.

## Test plan
- [ ] CI: vitest passes
- [ ] Manual: apply migration on staging snapshot; verify `project_members` count > 0 and zero rows for archived projects
EOF
)"
```

---

## PR2 — Members API + UI + Notification Swap

### Task 2.1: GET `/projects/[id]/members` route (TDD)

**Files:**
- Create: `tests/unit/project-members-route.test.ts`
- Create: `app/projects/[id]/members/route.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/project-members-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const listProjectMembersMock = vi.fn();
const addProjectMemberMock = vi.fn();
const removeProjectMemberMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  listProjectMembers: listProjectMembersMock,
  addProjectMember: addProjectMemberMock,
  removeProjectMember: removeProjectMemberMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, listProjectMembersMock, addProjectMemberMock, removeProjectMemberMock].forEach((m) => m.mockReset());
});

describe("GET /projects/[id]/members", () => {
  it("returns the member list", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    listProjectMembersMock.mockResolvedValue([
      { user_id: "u1", email: "a@x.com", first_name: "A", last_name: "A", added_at: new Date() }
    ]);
    const { GET } = await import("@/app/projects/[id]/members/route");
    const res = await GET(new Request("http://localhost/projects/p1/members"), {
      params: Promise.resolve({ id: "p1" })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test.** Expected: FAIL.

- [ ] **Step 3: Implement route.**

Create `app/projects/[id]/members/route.ts`:

```ts
import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { addProjectMember, getProject, listProjectMembers } from "@/lib/repositories";
import { z } from "zod";

const addMemberSchema = z.object({ userId: z.string().min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    const members = await listProjectMembers(id);
    return ok({ members });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-route.test.ts app/projects/[id]/members/route.ts
git commit -m "feat(api): GET /projects/[id]/members"
```

---

### Task 2.2: POST `/projects/[id]/members` route (TDD)

**Files:**
- Modify: `tests/unit/project-members-route.test.ts`
- Modify: `app/projects/[id]/members/route.ts`

- [ ] **Step 1: Add failing test.**

```ts
describe("POST /projects/[id]/members", () => {
  it("adds a member and returns 201", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    addProjectMemberMock.mockResolvedValue(undefined);
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({ userId: "u2" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(201);
    expect(addProjectMemberMock).toHaveBeenCalledWith("p1", "u2");
  });

  it("400 on invalid payload", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test.** Expected: FAIL.

- [ ] **Step 3: Implement.**

Append to `app/projects/[id]/members/route.ts`:

```ts
import { badRequest } from "@/lib/http";
import { ZodError } from "zod";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    const payload = addMemberSchema.parse(await request.json());
    await addProjectMember(id, payload.userId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    if (error instanceof ZodError) return badRequest("Invalid payload");
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-members-route.test.ts app/projects/[id]/members/route.ts
git commit -m "feat(api): POST /projects/[id]/members"
```

---

### Task 2.3: DELETE `/projects/[id]/members/[userId]` (TDD)

**Files:**
- Create: `tests/unit/project-member-delete-route.test.ts`
- Create: `app/projects/[id]/members/[userId]/route.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/unit/project-member-delete-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const removeProjectMemberMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  removeProjectMember: removeProjectMemberMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, removeProjectMemberMock].forEach((m) => m.mockReset());
});

describe("DELETE /projects/[id]/members/[userId]", () => {
  it("removes a member and returns 200", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    removeProjectMemberMock.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }), {
      params: Promise.resolve({ id: "p1", userId: "u2" })
    });
    expect(res.status).toBe(200);
    expect(removeProjectMemberMock).toHaveBeenCalledWith("p1", "u2");
  });

  it("returns 400 if removing would leave zero members", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    removeProjectMemberMock.mockRejectedValue(new Error("Cannot remove the last member of a project"));
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }), {
      params: Promise.resolve({ id: "p1", userId: "u2" })
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// app/projects/[id]/members/[userId]/route.ts
import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, removeProjectMember } from "@/lib/repositories";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    await requireUser(request);
    const { id, userId } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    try {
      await removeProjectMember(id, userId);
    } catch (error) {
      if (error instanceof Error && /last member/i.test(error.message)) {
        return badRequest(error.message);
      }
      throw error;
    }
    return ok({ ok: true });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/project-member-delete-route.test.ts "app/projects/[id]/members/[userId]/route.ts"
git commit -m "feat(api): DELETE /projects/[id]/members/[userId] with last-member guard"
```

---

### Task 2.4: GET `/users/active` route (TDD)

**Files:**
- Create: `tests/unit/users-active-route.test.ts`
- Create: `app/users/active/route.ts`
- Modify: `lib/repositories.ts` (add `listActiveUsers`)

- [ ] **Step 1: Write failing tests.**

```ts
// tests/unit/users-active-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const listActiveUsersMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({ listActiveUsers: listActiveUsersMock }));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, listActiveUsersMock].forEach((m) => m.mockReset());
});

describe("GET /users/active", () => {
  it("returns active users", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    listActiveUsersMock.mockResolvedValue([
      { id: "u1", email: "a@x.com", first_name: "A", last_name: "A" }
    ]);
    const { GET } = await import("@/app/users/active/route");
    const res = await GET(new Request("http://localhost/users/active"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users[0].email).toBe("a@x.com");
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Add repo helper.**

Append to `lib/repositories.ts`:

```ts
export type ActiveUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export async function listActiveUsers(): Promise<ActiveUser[]> {
  const result = await query(
    `select id, email, first_name, last_name
       from user_profiles
      where is_legacy = false
        and email is not null
      order by coalesce(first_name, ''), coalesce(last_name, '')`,
    []
  );
  return result.rows;
}
```

- [ ] **Step 4: Implement route.**

```ts
// app/users/active/route.ts
import { requireUser } from "@/lib/auth";
import { ok, serverError, unauthorized } from "@/lib/http";
import { listActiveUsers } from "@/lib/repositories";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const users = await listActiveUsers();
    return ok({ users });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add tests/unit/users-active-route.test.ts app/users/active/route.ts lib/repositories.ts
git commit -m "feat(api): GET /users/active for member picker"
```

---

### Task 2.5: Members section in `ProjectDialogForm` (RTL test + UI)

**Files:**
- Modify: `tests/unit/project-dialog-form.test.tsx` (or create if absent)
- Modify: `components/project-dialog-form.tsx`

- [ ] **Step 1: Write failing test.**

```tsx
// tests/unit/project-dialog-form.test.tsx — Members section
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectDialogForm } from "@/components/project-dialog-form";

describe("ProjectDialogForm Members section", () => {
  it("renders current members and supports remove", async () => {
    const onRemove = vi.fn();
    render(
      <ProjectDialogForm
        // ...minimum props (use existing defaults from other tests in this file)
        members={[
          { user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null }
        ]}
        activeUsers={[]}
        onAddMember={vi.fn()}
        onRemoveMember={onRemove}
      />
    );
    expect(screen.getByText("alex@x.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove alex@x.com/i }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("u1"));
  });

  it("blocks removing the last member", () => {
    render(
      <ProjectDialogForm
        members={[{ user_id: "u1", email: "alex@x.com", first_name: null, last_name: null }]}
        activeUsers={[]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /remove alex@x.com/i })).toBeDisabled();
  });
});
```

(Adapt remaining required props to match the existing form's signature; check the file before extending.)

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement Members section.**

In `components/project-dialog-form.tsx`, add to the props type:

```ts
type Member = { user_id: string; email: string; first_name: string | null; last_name: string | null };
type ActiveUser = { id: string; email: string; first_name: string | null; last_name: string | null };

type ProjectDialogFormProps = /* existing props */ & {
  members: Member[];
  activeUsers: ActiveUser[];
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
};
```

Render the section near the bottom of the existing form:

```tsx
<fieldset className="formGroup">
  <legend>Members</legend>
  <ul className="memberList">
    {members.map((m) => (
      <li key={m.user_id}>
        <span>{m.email}</span>
        <button
          type="button"
          aria-label={`Remove ${m.email}`}
          disabled={members.length <= 1}
          onClick={() => onRemoveMember(m.user_id)}
        >×</button>
      </li>
    ))}
  </ul>
  <select
    aria-label="Add member"
    value=""
    onChange={(e) => {
      if (e.target.value) onAddMember(e.target.value);
    }}
  >
    <option value="">Add a member…</option>
    {activeUsers
      .filter((u) => !members.some((m) => m.user_id === u.id))
      .map((u) => (
        <option key={u.id} value={u.id}>
          {u.email}
        </option>
      ))}
  </select>
</fieldset>
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Wire data in `app/[id]/page.tsx`.**

Add state for `members` and `activeUsers`. Fetch on dialog open:

```ts
const [members, setMembers] = useState<Member[]>([]);
const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);

async function loadMembersAndUsers() {
  const [mRes, uRes] = await Promise.all([
    authedJsonFetch(`/api/projects/${projectId}/members`),
    authedJsonFetch(`/api/users/active`)
  ]);
  setMembers(mRes.members);
  setActiveUsers(uRes.users);
}

async function handleAddMember(userId: string) {
  // optimistic
  const target = activeUsers.find((u) => u.id === userId);
  if (!target) return;
  setMembers((prev) => [...prev, { user_id: target.id, email: target.email, first_name: target.first_name, last_name: target.last_name }]);
  try {
    await authedJsonFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId })
    });
  } catch {
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    // surface toast
  }
}

async function handleRemoveMember(userId: string) {
  const previous = members;
  setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  try {
    await authedJsonFetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" });
  } catch {
    setMembers(previous);
  }
}
```

Pass `members`, `activeUsers`, `handleAddMember`, `handleRemoveMember` into `ProjectDialogForm`.

- [ ] **Step 6: Verify by running the dev server.**

```bash
npm run dev
```
Open a project, open Edit dialog, confirm Members list, add+remove flow works against local API.

- [ ] **Step 7: Commit.**

```bash
git add components/project-dialog-form.tsx tests/unit/project-dialog-form.test.tsx "app/[id]/page.tsx"
git commit -m "feat(ui): members section in project edit dialog"
```

---

### Task 2.6: Swap notification recipients in thread route (TDD)

**Files:**
- Modify: `tests/unit/thread-route.test.ts`
- Modify: `app/projects/[id]/threads/route.ts`

- [ ] **Step 1: Update existing test.**

In `tests/unit/thread-route.test.ts`, replace `listNotificationRecipientsMock` with `listProjectMemberRecipientsMock` (rename consistently). Update mock setup so the recipient call passes `projectId` and `actorId`:

```ts
const listProjectMemberRecipientsMock = vi.fn();
vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
  getProject: getProjectMock,
  createThread: createThreadMock,
  listThreads: listThreadsMock,
  getUserProfileById: getUserProfileByIdMock,
  listProjectMemberRecipients: listProjectMemberRecipientsMock
}));

// in the test:
listProjectMemberRecipientsMock.mockResolvedValue([
  { id: "user-2", email: "jamie@example.com", firstName: "Jamie", lastName: "Teammate" }
]);

// after POST:
expect(listProjectMemberRecipientsMock).toHaveBeenCalledWith("project-1", "user-1");
```

- [ ] **Step 2: Run test.** Expected: FAIL (route still uses old import).

- [ ] **Step 3: Modify route.**

In `app/projects/[id]/threads/route.ts`:

```ts
// at the top:
import {
  assertClientNotArchivedForMutation,
  createThread,
  getProject,
  getUserProfileById,
  listProjectMemberRecipients,
  listThreads
} from "@/lib/repositories";
```

In POST, replace:
```ts
const [actorProfile, recipients] = await Promise.all([
  getUserProfileById(user.id),
  listNotificationRecipients()
]);
```
with:
```ts
const [actorProfile, recipients] = await Promise.all([
  getUserProfileById(user.id),
  listProjectMemberRecipients(id, user.id)
]);
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/thread-route.test.ts "app/projects/[id]/threads/route.ts"
git commit -m "refactor(notify): scope thread-created emails to project members"
```

---

### Task 2.7: Swap notification recipients in comment route (TDD)

**Files:**
- Modify: `tests/unit/thread-route.test.ts` (if covers comments) OR locate the comment route test
- Modify: `app/projects/[id]/threads/[threadId]/comments/route.ts`

- [ ] **Step 1: Find the test file.**

```bash
grep -ln "comments/route" tests/unit
```

- [ ] **Step 2: Update test mocks** (same pattern as Task 2.6 — rename `listNotificationRecipients` to `listProjectMemberRecipients`, assert call args `(projectId, user.id)`). If no test exists, write one mirroring `tests/unit/thread-route.test.ts`.

- [ ] **Step 3: Run.** Expected: FAIL.

- [ ] **Step 4: Modify route.**

In `app/projects/[id]/threads/[threadId]/comments/route.ts`, change the import and the call site identical to Task 2.6.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add tests/unit "app/projects/[id]/threads/[threadId]/comments/route.ts"
git commit -m "refactor(notify): scope comment-created emails to project members"
```

---

### Task 2.8: Open PR2

- [ ] **Step 1: Push and open.**

```bash
gh pr create --title "feat: members CRUD + project-scoped notifications" --body "$(cat <<'EOF'
## Summary
- New routes: GET/POST /projects/[id]/members, DELETE /projects/[id]/members/[userId], GET /users/active.
- Members section in ProjectDialogForm.
- Thread + comment notifications now scope to project members minus actor.

## Behavior change
Users currently receive notifications for every project. After this PR they only receive notifications for projects where they are listed as members. Backfill (PR1) preserves existing recipients for active projects.

## Test plan
- [ ] CI: vitest passes
- [ ] Manual: add/remove members, verify member visible after refresh
- [ ] Manual: post a comment, confirm only members get the email
EOF
)"
```

---

## PR3 — Edit Thread

### Task 3.1: Add `editThread` repo helper (TDD)

**Files:**
- Create: `tests/unit/edit-thread-repo.test.ts`
- Modify: `lib/repositories.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/edit-thread-repo.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: queryMock }));

beforeEach(() => queryMock.mockReset());
afterEach(() => vi.resetModules());

describe("editThread", () => {
  it("updates title, body_markdown, body_html, edited_at", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "t1", title: "New", body_markdown: "Hi", body_html: "<p>Hi</p>", edited_at: new Date() }]
    });
    const { editThread } = await import("@/lib/repositories");
    const result = await editThread({ projectId: "p1", threadId: "t1", title: "New", bodyMarkdown: "Hi" });
    expect(result.title).toBe("New");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/update threads set/i);
    expect(sql).toMatch(/edited_at = now\(\)/i);
    expect(params).toEqual(["New", "Hi", expect.any(String), "t1", "p1"]);
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

Append to `lib/repositories.ts`:

```ts
import { renderMarkdownToHtml } from "@/lib/markdown"; // adapt to existing helper used by createThread

export async function editThread(args: {
  projectId: string;
  threadId: string;
  title: string;
  bodyMarkdown: string;
}) {
  const bodyHtml = await renderMarkdownToHtml(args.bodyMarkdown);
  const result = await query(
    `update threads
        set title = $1,
            body_markdown = $2,
            body_html = $3,
            edited_at = now()
      where id = $4 and project_id = $5
      returning id, title, body_markdown, body_html, edited_at`,
    [args.title, args.bodyMarkdown, bodyHtml, args.threadId, args.projectId]
  );
  return result.rows[0];
}
```

(Use the same markdown render helper that `createThread` uses; if it's inline in `createThread`, copy that approach.)

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/edit-thread-repo.test.ts lib/repositories.ts
git commit -m "feat(repo): editThread updates body and sets edited_at"
```

---

### Task 3.2: PATCH `/projects/[id]/threads/[threadId]` (TDD)

**Files:**
- Create: `tests/unit/thread-edit-route.test.ts`
- Modify: `app/projects/[id]/threads/[threadId]/route.ts`

- [ ] **Step 1: Write failing tests.**

```ts
// tests/unit/thread-edit-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const editThreadMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  getThread: getThreadMock,
  editThread: editThreadMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, getThreadMock, editThreadMock].forEach((m) => m.mockReset());
});

describe("PATCH /projects/[id]/threads/[threadId]", () => {
  it("403 when caller is not the author", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue({ id: "t1", author_user_id: "someone-else" });
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("200 and updates when caller is the author", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue({ id: "t1", author_user_id: "u1" });
    editThreadMock.mockResolvedValue({ id: "t1", title: "X", body_markdown: "Y", body_html: "<p>Y</p>", edited_at: new Date() });
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(200);
    expect(editThreadMock).toHaveBeenCalledWith({
      projectId: "p1",
      threadId: "t1",
      title: "X",
      bodyMarkdown: "Y"
    });
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL — `PATCH` not exported.

- [ ] **Step 3: Implement.**

In `app/projects/[id]/threads/[threadId]/route.ts`, append:

```ts
import { requireUser } from "@/lib/auth";
import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { editThread, getProject, getThread } from "@/lib/repositories";
import { ZodError, z } from "zod";

const editThreadSchema = z.object({
  title: z.string().min(1),
  bodyMarkdown: z.string().min(1)
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, threadId } = await params;
    const project = await getProject(id);
    if (!project) return notFound("Project not found");
    const thread = await getThread(id, threadId);
    if (!thread) return notFound("Thread not found");
    if ((thread as { author_user_id: string }).author_user_id !== user.id) {
      return forbidden("Only the author can edit this discussion");
    }
    const payload = editThreadSchema.parse(await request.json());
    const updated = await editThread({ projectId: id, threadId, title: payload.title, bodyMarkdown: payload.bodyMarkdown });
    return ok({ thread: updated });
  } catch (error) {
    if (error instanceof ZodError) return badRequest("Invalid payload");
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

If `forbidden` does not exist in `lib/http`, add it (mirror `notFound`/`badRequest`):

```ts
export function forbidden(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "content-type": "application/json" }
  });
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/thread-edit-route.test.ts "app/projects/[id]/threads/[threadId]/route.ts" lib/http.ts
git commit -m "feat(api): PATCH thread (author-only edit)"
```

---

### Task 3.3: Discussion-page edit UI

**Files:**
- Modify: `app/[id]/[discussion]/page.tsx`

- [ ] **Step 1: Add edit state.**

Near the existing thread render, add:

```tsx
const [isEditingThread, setIsEditingThread] = useState(false);
const [editTitle, setEditTitle] = useState("");
const [editBody, setEditBody] = useState("");

const isAuthor = currentUser?.id && thread?.author_user_id === currentUser.id;

function openEdit() {
  if (!thread) return;
  setEditTitle(thread.title);
  setEditBody(thread.body_markdown ?? "");
  setIsEditingThread(true);
}

async function saveEdit() {
  const updated = await authedJsonFetch(`/api/projects/${projectId}/threads/${thread.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: editTitle, bodyMarkdown: editBody })
  });
  setThread((prev) => (prev ? { ...prev, ...updated.thread } : prev));
  setIsEditingThread(false);
}
```

(Adapt to the actual state shape used in this file — read the bootstrap/state setup first.)

- [ ] **Step 2: Render edit button + edit mode + edited indicator.**

Replace the existing thread title/body block:

```tsx
{isAuthor && !isEditingThread && (
  <OneShotButton type="button" className="iconButton" aria-label="Edit discussion" onClick={openEdit}>
    Edit
  </OneShotButton>
)}
{isEditingThread ? (
  <>
    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="Edit title" />
    <MarkdownEditor value={editBody} onChange={setEditBody} />
    <OneShotButton type="button" onClick={saveEdit}>Save</OneShotButton>
    <OneShotButton type="button" className="secondary" onClick={() => setIsEditingThread(false)}>Cancel</OneShotButton>
  </>
) : (
  <>
    <h1>{thread?.title}</h1>
    <MarkdownHtml html={thread?.body_html ?? ""} />
    {thread?.edited_at && (
      <small className="threadEditedIndicator">edited {new Date(thread.edited_at).toLocaleString()}</small>
    )}
  </>
)}
```

- [ ] **Step 3: Update the `ThreadDetail` type** to include `body_markdown: string` and `edited_at: string | null`. Update bootstrap server response to include these fields if not already present (verify via API response shape).

- [ ] **Step 4: Verify in dev.**

```bash
npm run dev
```
Open a discussion as the author, click Edit, change title + body, save. Refresh — change persists, "edited" indicator shows.

- [ ] **Step 5: Commit.**

```bash
git add "app/[id]/[discussion]/page.tsx"
git commit -m "feat(ui): edit thread inline with edited indicator"
```

---

### Task 3.4: Open PR3

```bash
gh pr create --title "feat: edit discussion (author-only)" --body "..."
```

---

## PR4 — Attachments On New Thread

### Task 4.1: Extract `useAttachmentUploads` hook (TDD)

**Files:**
- Create: `lib/use-attachment-uploads.ts`
- Create: `tests/unit/use-attachment-uploads.test.ts`
- Modify: `app/[id]/[discussion]/page.tsx` to consume the hook
- Modify: `components/discussions/discussion-composer.tsx` (no API change; same props)

- [ ] **Step 1: Inventory current state.**

Open `app/[id]/[discussion]/page.tsx`. Identify: `pendingAttachments`, `setPendingAttachments`, `addPendingFiles`, `removePendingAttachment`, `uploadAttachments`, the `upload-init` and `upload-complete` flow. These move into the hook.

- [ ] **Step 2: Write failing test.**

```ts
// tests/unit/use-attachment-uploads.test.ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttachmentUploads } from "@/lib/use-attachment-uploads";

describe("useAttachmentUploads", () => {
  it("queues a file as a pending attachment", () => {
    const { result } = renderHook(() => useAttachmentUploads({ projectId: "p1" }));
    act(() => {
      result.current.addPendingFiles([new File(["hi"], "a.txt", { type: "text/plain" })]);
    });
    expect(result.current.pendingAttachments).toHaveLength(1);
    expect(result.current.pendingAttachments[0].file.name).toBe("a.txt");
  });
});
```

- [ ] **Step 3: Run.** Expected: FAIL.

- [ ] **Step 4: Implement the hook.**

Move the existing state and helpers from `app/[id]/[discussion]/page.tsx` into `lib/use-attachment-uploads.ts`:

```ts
"use client";
import { useCallback, useState } from "react";
// ...existing helpers (hashing, upload-init, upload-complete, progress wiring)

export type PendingAttachment = {
  id: string;
  file: File;
  progress: number;
  stage: "queued" | "hashing" | "uploading" | "done" | "error";
  error?: string;
  attachmentId?: string;
};

export function useAttachmentUploads(args: { projectId: string }) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isAttachmentDragActive, setIsAttachmentDragActive] = useState(false);
  const isUploadingAttachments = pendingAttachments.some((a) => a.stage === "hashing" || a.stage === "uploading");

  const addPendingFiles = useCallback((files: FileList | File[]) => { /* port from page */ }, []);
  const removePendingAttachment = useCallback((id: string) => { /* port from page */ }, []);
  const uploadAll = useCallback(async () => { /* port from page; returns array of attachmentIds */ }, [args.projectId]);
  const reset = useCallback(() => setPendingAttachments([]), []);

  return {
    pendingAttachments,
    isAttachmentDragActive,
    setIsAttachmentDragActive,
    isUploadingAttachments,
    addPendingFiles,
    removePendingAttachment,
    uploadAll,
    reset
  };
}
```

- [ ] **Step 5: Wire the discussion page to consume the hook.**

In `app/[id]/[discussion]/page.tsx`, replace inline state with `const upload = useAttachmentUploads({ projectId });` and pass `upload.pendingAttachments`, `upload.addPendingFiles`, etc., into `DiscussionComposer`. Behavior unchanged.

- [ ] **Step 6: Run all related tests.**

Run: `npx vitest run tests/unit/use-attachment-uploads.test.ts tests/unit/discussion-composer.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify in dev** that comment attachment upload still works end-to-end.

- [ ] **Step 8: Commit.**

```bash
git add lib/use-attachment-uploads.ts tests/unit/use-attachment-uploads.test.ts "app/[id]/[discussion]/page.tsx"
git commit -m "refactor(uploads): extract useAttachmentUploads hook"
```

---

### Task 4.2: Wire attachments into `CreateDiscussionDialog` (TDD)

**Files:**
- Modify: `components/discussions/create-discussion-dialog.tsx`
- Modify: `tests/unit/create-discussion-dialog.test.tsx`
- Modify: `app/[id]/page.tsx` (caller)

- [ ] **Step 1: Update test to expect attachments slot and submit gating.**

```tsx
import { useAttachmentUploads } from "@/lib/use-attachment-uploads";

it("disables Create when an attachment is still uploading", () => {
  const markup = renderToStaticMarkup(
    <CreateDiscussionDialog
      dialogRef={createRef<HTMLDialogElement>()}
      title="X"
      bodyMarkdown="Y"
      editor={<div />}
      onTitleChange={vi.fn()}
      onCreate={vi.fn()}
      onCancel={vi.fn()}
      attachmentsSlot={<div className="attach-stub" />}
      canSubmit={false}
    />
  );
  expect(markup).toContain("attach-stub");
  expect(markup).toMatch(/<button[^>]*disabled[^>]*>Create</);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Update the component.**

Add to props: `attachmentsSlot: ReactNode; canSubmit?: boolean;`. Render `attachmentsSlot` between editor and the row. Use `canSubmit ?? Boolean(title && bodyMarkdown)` for the Create button's disabled state.

- [ ] **Step 4: Wire in the parent (`app/[id]/page.tsx`).**

```tsx
const newThreadUploads = useAttachmentUploads({ projectId });
const canSubmitNewThread =
  Boolean(newThreadTitle && newThreadBody) && !newThreadUploads.isUploadingAttachments;

async function handleCreateDiscussion() {
  const attachmentIds = await newThreadUploads.uploadAll();
  await authedJsonFetch(`/api/projects/${projectId}/threads`, {
    method: "POST",
    body: JSON.stringify({
      title: newThreadTitle,
      bodyMarkdown: newThreadBody,
      attachmentIds
    })
  });
  newThreadUploads.reset();
  setNewThreadTitle("");
  setNewThreadBody("");
  createDiscussionDialogRef.current?.close();
}

<CreateDiscussionDialog
  /* existing props */
  attachmentsSlot={
    <DiscussionAttachmentsField uploads={newThreadUploads} />
  }
  canSubmit={canSubmitNewThread}
  onCreate={handleCreateDiscussion}
/>
```

If reusing `DiscussionComposer`'s attachment UI, factor it into a small `<DiscussionAttachmentsField>` component that takes the hook's return object as props — so both the dialog and the in-page composer render the same UI.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Verify in dev** — create a discussion with two attachments. Confirm files appear under the new thread.

- [ ] **Step 7: Commit.**

```bash
git add components/discussions/create-discussion-dialog.tsx tests/unit/create-discussion-dialog.test.tsx "app/[id]/page.tsx"
git commit -m "feat(ui): attachments on create-discussion form"
```

---

### Task 4.3: Accept `attachmentIds` on POST thread (TDD)

**Files:**
- Modify: `tests/unit/thread-route.test.ts`
- Modify: `app/projects/[id]/threads/route.ts`
- Modify: `lib/repositories.ts` (`createThread` to accept `attachmentIds` and link them)

- [ ] **Step 1: Add failing test.**

```ts
it("links provided attachmentIds to the new thread", async () => {
  // standard mocks…
  const { POST } = await import("@/app/projects/[id]/threads/route");
  await POST(
    new Request("http://localhost/projects/p1/threads", {
      method: "POST",
      body: JSON.stringify({ title: "T", bodyMarkdown: "B", attachmentIds: ["a1", "a2"] }),
      headers: { "content-type": "application/json" }
    }),
    { params: Promise.resolve({ id: "p1" }) }
  );
  expect(createThreadMock).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentIds: ["a1", "a2"] })
  );
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Update zod schema and pass through.**

In `app/projects/[id]/threads/route.ts`:

```ts
const createThreadSchema = z.object({
  title: z.string().min(1),
  bodyMarkdown: z.string().min(1),
  attachmentIds: z.array(z.string()).optional()
});

// later:
const thread = await createThread({
  projectId: id,
  title: payload.title,
  bodyMarkdown: payload.bodyMarkdown,
  authorUserId: user.id,
  attachmentIds: payload.attachmentIds ?? []
});
```

- [ ] **Step 4: Update `createThread` repo to accept and link attachments.**

Find the existing `linkCommentAttachments` (or equivalent) used by comments. Mirror it for threads: after thread insert, run an `update` on `comment_attachments` (or whichever table holds attachments) setting `thread_id = $1` where `id = any($2)` and the row currently has no parent. The exact column model lives in `lib/repositories.ts`; reuse the existing helper if one already exists for thread-attachments. If only comment-attachments are wired, extend the table/columns appropriately based on the existing schema.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add tests/unit/thread-route.test.ts "app/projects/[id]/threads/route.ts" lib/repositories.ts
git commit -m "feat(api): POST thread accepts attachmentIds and links them"
```

---

### Task 4.4: Render attachment names in thread-created email (TDD)

**Files:**
- Modify: `tests/unit/mailer.test.ts`
- Modify: `lib/mailer.ts`
- Modify: `app/projects/[id]/threads/route.ts` (pass attachment names through)

- [ ] **Step 1: Add failing test.**

```ts
it("includes attachment filenames in the thread-created email body", async () => {
  const { sendThreadCreatedEmail } = await import("@/lib/mailer");
  const result = await sendThreadCreatedEmail({
    recipients: [{ email: "x@x.com", name: "X" }],
    actor: { name: "A", email: "a@x.com" },
    project: { id: "p1", name: "Demo", client_code: null, project_code: null },
    thread: { id: "t1", title: "T", bodyMarkdown: "B" },
    threadUrl: "http://x",
    attachments: [{ filename: "spec.pdf" }, { filename: "logo.png" }]
  });
  // assert text/html include filenames — check via the sendMail mock
  expect(/* captured html */).toMatch(/spec\.pdf/);
  expect(/* captured html */).toMatch(/logo\.png/);
});
```

(Adapt to existing mailer test harness, which already mocks `sendMail`.)

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Extend `ThreadEmailArgs`.**

In `lib/mailer.ts`:

```ts
type ThreadEmailArgs = {
  recipients: MailRecipient[];
  actor: { name: string; email: string };
  project: { id: string; name: string; client_code?: string | null; project_code?: string | null };
  thread: { id: string; title: string; bodyMarkdown: string };
  threadUrl: string;
  attachments?: { filename: string }[];
};

function buildThreadEmailContent(args: ThreadEmailArgs, opts: ThreadEmailContentOpts) {
  // existing logic…

  const attachmentNames = args.attachments?.map((a) => a.filename) ?? [];
  const attachmentText = attachmentNames.length
    ? `\nAttachments: ${attachmentNames.join(", ")}\n`
    : "";
  const attachmentHtml = attachmentNames.length
    ? `<p><strong>Attachments:</strong> ${attachmentNames.map((n) => escapeHtml(n)).join(", ")}</p>`
    : "";

  // splice into text/html outputs in the existing builder
}
```

- [ ] **Step 4: Pass attachments from route.**

In `app/projects/[id]/threads/route.ts`, after `createThread` returns, if it also returned attachment metadata, forward it. Otherwise, accept the original payload's filenames (they were known at upload time on the client). Easiest: have `createThread` return an `attachments: { filename: string }[]` array based on linked rows; pass that into `sendThreadCreatedEmail`.

- [ ] **Step 5: Run tests.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add tests/unit/mailer.test.ts lib/mailer.ts "app/projects/[id]/threads/route.ts"
git commit -m "feat(notify): include attachment names in thread-created email"
```

---

### Task 4.5: Same email change for comments (TDD)

**Files:**
- Modify: `tests/unit/mailer.test.ts`
- Modify: `lib/mailer.ts` (`CommentEmailArgs` already extends `ThreadEmailArgs`, so the field is inherited)
- Modify: `app/projects/[id]/threads/[threadId]/comments/route.ts` (pass attachment names)

- [ ] **Step 1: Mirror Task 4.4 with the comment-created email** — extend test, pass `attachments` from the comment route, render filenames in the comment email body.

- [ ] **Step 2: Commit.**

```bash
git add tests/unit lib/mailer.ts "app/projects/[id]/threads/[threadId]/comments/route.ts"
git commit -m "feat(notify): include attachment names in comment-created email"
```

---

### Task 4.6: Open PR4

```bash
gh pr create --title "feat: attachments on new discussion + email attachment lists" --body "..."
```

---

## End-to-End Verification (after all four PRs)

- [ ] **Step 1: Add an E2E flow.**

Modify `tests/e2e/user-flow.test.ts` to cover:
1. Create a project (creator auto-added to members).
2. Open project edit dialog, add a second user as member.
3. Start a discussion with one attachment.
4. Have the second user post a comment.
5. Assert the first user (actor) didn't receive an email for their own thread; the second user did.

- [ ] **Step 2: Commit.**

```bash
git add tests/e2e/user-flow.test.ts
git commit -m "test(e2e): members + discussion attachment + scoped notifications"
```

---

## Self-Review Notes

- All spec sections covered: schema (PR1.T1.1), repo helpers (PR1.T1.2-T1.5), creator auto-add (PR1.T1.6), members API (PR2.T2.1-T2.4), members UI (PR2.T2.5), notification swap (PR2.T2.6-T2.7), edit thread (PR3), attachments on create (PR4), email attachment names (PR4.T4.4-T4.5).
- Each migration task includes the backup checklist before applying.
- Last-member rule enforced both in repo (Task 1.3) and DELETE route (Task 2.3).
- `forbidden` helper is added once in `lib/http.ts` (Task 3.2) — referenced once and only created if missing.
- The `createThread` repo function's exact attachment-linking implementation is partially deferred to read-time inspection (Task 4.3 Step 4) because the comments-attachments table model is not fully captured here; the task explicitly tells the engineer to inspect existing `linkCommentAttachments` and mirror.
