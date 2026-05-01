# Project Page Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5-minute project-page polling that catches all project activity, refreshes only when local drafts are clean, and marks newly discovered discussion/file/expense rows with a session-only `New` pill.

**Architecture:** Add a lightweight `GET /projects/[id]/updated-date` route backed by a repository helper that returns `greatest(projects.updated_at, coalesce(projects.last_activity_at, projects.updated_at))`. The project page polls that route every 5 minutes. When the timestamp advances and the page has no dirty drafts or active mutations, it reuses existing `loadProjectData`. Poll-applied refreshes compare old and new row IDs to populate session-only `New` pill sets. Spec: `docs/superpowers/specs/2026-04-30-project-page-polling-design.md`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, raw `pg` repositories, Vitest, pnpm.

---

## File Structure

- Create: `app/projects/[id]/updated-date/route.ts` — timestamp API route.
- Modify: `lib/repositories.ts` — add `getProjectUpdatedDate`.
- Create: `tests/unit/project-updated-date-route.test.ts` — route tests.
- Create: `lib/project-page-polling.ts` — pure client helper functions for timestamp comparison, dirty checks, and new-ID detection.
- Create: `tests/unit/project-page-polling.test.ts` — helper tests.
- Modify: `app/[id]/page.tsx` — polling state/effect, dirty guard integration, row `New` pills.
- Modify: `components/projects/project-files-panel.tsx` — file `New` pill prop/rendering.
- Modify: `app/styles.css` — shared pill styling.

---

## Task 1: Timestamp API

**Files:**
- Modify: `lib/repositories.ts`
- Create: `app/projects/[id]/updated-date/route.ts`
- Create: `tests/unit/project-updated-date-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/unit/project-updated-date-route.test.ts` with Vitest mocks matching existing route tests:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectUpdatedDateMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({ getProjectUpdatedDate: getProjectUpdatedDateMock }));

describe("GET /projects/[id]/updated-date", () => {
  beforeEach(() => {
    vi.resetModules();
    requireUserMock.mockReset();
    getProjectUpdatedDateMock.mockReset();
  });

  it("returns the project activity updated date", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectUpdatedDateMock.mockResolvedValue({ updatedDate: "2026-04-30T12:34:56.789Z" });

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/updated-date", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(getProjectUpdatedDateMock).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toEqual({ updatedDate: "2026-04-30T12:34:56.789Z" });
  });

  it("returns 404 when the project is missing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectUpdatedDateMock.mockResolvedValue(null);

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(new Request("http://localhost/projects/missing/updated-date"), {
      params: Promise.resolve({ id: "missing" })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Project not found" });
  });

  it("returns unauthorized for auth failures", async () => {
    requireUserMock.mockRejectedValue(new Error("Invalid auth token"));

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(new Request("http://localhost/projects/project-1/updated-date"), {
      params: Promise.resolve({ id: "project-1" })
    });

    expect(response.status).toBe(401);
    expect(getProjectUpdatedDateMock).not.toHaveBeenCalled();
  });
});
```

Run:

```bash
pnpm vitest run tests/unit/project-updated-date-route.test.ts
```

Expected: fails because the route/helper do not exist.

- [ ] **Step 2: Add repository helper**

In `lib/repositories.ts`, add:

```ts
export async function getProjectUpdatedDate(id: string): Promise<{ updatedDate: string } | null> {
  const result = await query(
    `select greatest(updated_at, coalesce(last_activity_at, updated_at)) as "updatedDate"
     from projects
     where id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 3: Add route**

Create `app/projects/[id]/updated-date/route.ts`:

```ts
import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectUpdatedDate } from "@/lib/repositories";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const project = await getProjectUpdatedDate(id);
    if (!project) {
      return notFound("Project not found");
    }
    return ok({ updatedDate: project.updatedDate });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run tests/unit/project-updated-date-route.test.ts
```

Expected: all tests pass.

Commit:

```bash
git add lib/repositories.ts app/projects/[id]/updated-date/route.ts tests/unit/project-updated-date-route.test.ts
git commit -m "Add project updated date polling endpoint"
```

---

## Task 2: Polling Helper Tests

**Files:**
- Create: `lib/project-page-polling.ts`
- Create: `tests/unit/project-page-polling.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/project-page-polling.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  collectNewIds,
  hasDirtyProjectPageDrafts,
  isNewerProjectUpdate
} from "@/lib/project-page-polling";

describe("isNewerProjectUpdate", () => {
  it("only treats strictly newer timestamps as updates", () => {
    expect(isNewerProjectUpdate("2026-04-30T12:05:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(true);
    expect(isNewerProjectUpdate("2026-04-30T12:00:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(false);
    expect(isNewerProjectUpdate("2026-04-30T11:55:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(false);
  });
});

describe("collectNewIds", () => {
  it("returns ids not present in the seen set", () => {
    expect(collectNewIds([{ id: "a" }, { id: "b" }], new Set(["a"]))).toEqual(new Set(["b"]));
  });
});

describe("hasDirtyProjectPageDrafts", () => {
  const clean = {
    projectFormDirty: false,
    myHoursDirty: false,
    archivedHoursDirty: false,
    expenseDraftsDirty: false,
    newExpenseDirty: false,
    fileQueued: false,
    createDiscussionDirty: false,
    mutationInFlight: false
  };

  it("is false when no draft or mutation is active", () => {
    expect(hasDirtyProjectPageDrafts(clean)).toBe(false);
  });

  it("is true when any draft is dirty", () => {
    expect(hasDirtyProjectPageDrafts({ ...clean, expenseDraftsDirty: true })).toBe(true);
  });

  it("is true while a mutation is in flight", () => {
    expect(hasDirtyProjectPageDrafts({ ...clean, mutationInFlight: true })).toBe(true);
  });
});
```

Run:

```bash
pnpm vitest run tests/unit/project-page-polling.test.ts
```

Expected: fails because the helper does not exist.

- [ ] **Step 2: Add pure helpers**

Create `lib/project-page-polling.ts`:

```ts
export type ProjectPageDirtyState = {
  projectFormDirty: boolean;
  myHoursDirty: boolean;
  archivedHoursDirty: boolean;
  expenseDraftsDirty: boolean;
  newExpenseDirty: boolean;
  fileQueued: boolean;
  createDiscussionDirty: boolean;
  mutationInFlight: boolean;
};

export function isNewerProjectUpdate(nextUpdatedDate: string | null | undefined, currentUpdatedDate: string | null | undefined) {
  if (!nextUpdatedDate || !currentUpdatedDate) return Boolean(nextUpdatedDate);
  return new Date(nextUpdatedDate).getTime() > new Date(currentUpdatedDate).getTime();
}

export function collectNewIds<T extends { id: string }>(items: T[], seenIds: ReadonlySet<string>) {
  return new Set(items.map((item) => item.id).filter((id) => !seenIds.has(id)));
}

export function hasDirtyProjectPageDrafts(state: ProjectPageDirtyState) {
  return Object.values(state).some(Boolean);
}
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm vitest run tests/unit/project-page-polling.test.ts
```

Expected: all tests pass.

Commit:

```bash
git add lib/project-page-polling.ts tests/unit/project-page-polling.test.ts
git commit -m "Add project page polling helpers"
```

---

## Task 3: Client Polling and Dirty Guard

**Files:**
- Modify: `app/[id]/page.tsx`

- [ ] **Step 1: Import helpers and extend type**

In `app/[id]/page.tsx`, import:

```ts
import {
  collectNewIds,
  hasDirtyProjectPageDrafts,
  isNewerProjectUpdate
} from "@/lib/project-page-polling";
```

Extend `type Project` with:

```ts
  updated_at?: string | null;
  last_activity_at?: string | null;
```

- [ ] **Step 2: Add polling refs/state near existing state**

Inside `ProjectPageContent`, add:

```ts
  const projectActivityUpdatedDateRef = useRef(getProjectActivityUpdatedDate(initial.project));
  const pendingProjectRefreshRef = useRef<string | null>(null);
  const seenThreadIdsRef = useRef(new Set(initial.threads.map((thread) => thread.id)));
  const seenFileIdsRef = useRef(new Set(initial.files.map((file) => file.id)));
  const seenExpenseLineIdsRef = useRef(new Set(initial.expenseLines.map((line) => line.id)));
  const [newThreadIds, setNewThreadIds] = useState<Set<string>>(() => new Set());
  const [newFileIds, setNewFileIds] = useState<Set<string>>(() => new Set());
  const [newExpenseLineIds, setNewExpenseLineIds] = useState<Set<string>>(() => new Set());
```

Add a module-level helper near other helpers:

```ts
function getProjectActivityUpdatedDate(project: Project | null) {
  if (!project) return null;
  const candidates = [project.updated_at, project.last_activity_at].filter(Boolean) as string[];
  return candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}
```

- [ ] **Step 3: Add dirty calculation**

Inside `ProjectPageContent`, derive `isProjectPageDirty` from existing local state. Include:

- `projectFormDirty`: compare `projectForm` to `createProjectDialogValues(project?.client_id ?? "", project)` with `JSON.stringify`.
- `myHoursDirty`: `myHoursInput !== formatHoursInput(project?.my_hours)`.
- `archivedHoursDirty`: any `archivedHoursInputs[entry.userId] !== formatHoursInput(entry.hours)`.
- `expenseDraftsDirty`: any draft label/amount differs from saved line values.
- `newExpenseDirty`: trimmed label or amount is non-empty.
- `fileQueued`: `selectedFile !== null`.
- `createDiscussionDirty`: false unless create discussion draft state is lifted into this page in the current codebase; do not invent invasive dialog plumbing in this task.
- `mutationInFlight`: any existing save/upload/create/delete/restoring flag is active.

Use `hasDirtyProjectPageDrafts`.

- [ ] **Step 4: Add refresh applier**

Add an `applyPolledProjectData(nextState, updatedDate)` callback that:

- Calculates new thread/file/expense IDs with `collectNewIds`.
- Merges them into `newThreadIds`, `newFileIds`, `newExpenseLineIds`.
- Replaces `project`, `userHours`, `expenseLines`, `threads`, `files`, `clients`, and `viewerProfile` using the existing state setters.
- Updates all seen ID refs to include the returned rows.
- Sets `projectActivityUpdatedDateRef.current = updatedDate`.
- Clears `pendingProjectRefreshRef.current`.

- [ ] **Step 5: Add polling effect**

Add a `useEffect` that depends on `token`, `projectId`, `load`, and `isProjectPageDirty`.

Behavior:

- If no `token` or no `projectId`, return.
- Every 5 minutes, call `authedFetch(token, `/projects/${projectId}/updated-date`)`.
- If `isNewerProjectUpdate(data.updatedDate, projectActivityUpdatedDateRef.current)` is false, return.
- If dirty, set `pendingProjectRefreshRef.current = data.updatedDate` and return.
- If clean, call `loadProjectData(token, projectId)` and `applyPolledProjectData`.
- Cleanup must clear the interval and prevent state updates after unmount.

Use `const PROJECT_PAGE_POLL_INTERVAL_MS = 5 * 60 * 1000;` at module scope.

- [ ] **Step 6: Keep local mutations from self-marking as new**

After successful local creation/upload handlers update state, add returned IDs to the matching seen ref:

- `createThread`: add `thread.id` to `seenThreadIdsRef.current`.
- `uploadSelectedFile`: add uploaded `file.id` to `seenFileIdsRef.current`.
- `createExpenseLine`: add `expenseLine.id` to `seenExpenseLineIdsRef.current`.

Do not add those IDs to `new*Ids`.

- [ ] **Step 7: Typecheck**

Run:

```bash
pnpm tsc --noEmit
```

Expected: no TypeScript errors.

Do not commit yet; Task 4 completes the UI rendering.

---

## Task 4: New Pill Rendering and Styles

**Files:**
- Modify: `app/[id]/page.tsx`
- Modify: `components/projects/project-files-panel.tsx`
- Modify: `app/styles.css`

- [ ] **Step 1: Render discussion pills**

In the discussions list in `app/[id]/page.tsx`, render:

```tsx
{newThreadIds.has(thread.id) ? <span className="newItemPill">New</span> : null}
```

Place it next to the discussion title inside the link row without changing the link href.

- [ ] **Step 2: Render expense pills**

In the expense line row in `app/[id]/page.tsx`, render:

```tsx
{newExpenseLineIds.has(line.id) ? <span className="newItemPill">New</span> : null}
```

Place it next to the saved/draft label display area so it does not interfere with inputs/buttons.

- [ ] **Step 3: Pass and render file pills**

In `components/projects/project-files-panel.tsx`, extend props:

```ts
  newFileIds?: ReadonlySet<string>;
```

Default it to an empty set in destructuring. Next to each file name, render:

```tsx
{newFileIds.has(file.id) ? <span className="newItemPill">New</span> : null}
```

In `app/[id]/page.tsx`, pass `newFileIds={newFileIds}` to `ProjectFilesPanel`.

- [ ] **Step 4: Add styles**

In `app/styles.css`, add:

```css
.newItemPill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.25rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--active-border) 35%, transparent);
  background: color-mix(in srgb, var(--active-border) 18%, var(--panel-bg));
  color: var(--active-text);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
```

If a row needs spacing, add small layout selectors near the existing `.projectRow`, `.fileThumbMeta`, or expense row styles rather than changing global pill margins.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm tsc --noEmit
pnpm vitest run tests/unit/project-page-polling.test.ts tests/unit/project-updated-date-route.test.ts
```

Expected: typecheck and tests pass.

Commit:

```bash
git add app/[id]/page.tsx components/projects/project-files-panel.tsx app/styles.css
git commit -m "Add project page polling new item indicators"
```

---

## Task 5: Full Verification

**Files:** no planned edits unless verification finds defects.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/unit/project-updated-date-route.test.ts tests/unit/project-page-polling.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full unit suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Manual browser smoke**

Run the app:

```bash
pnpm dev
```

Manual checks:

- Open a project page.
- In another tab/session, create a discussion, upload a file, or add an expense line.
- Temporarily reduce `PROJECT_PAGE_POLL_INTERVAL_MS` locally or wait 5 minutes.
- Confirm a clean page refreshes and shows `New` beside only the newly discovered row.
- Begin editing an expense or hours field, trigger an external update, and confirm the local draft is not overwritten.
- Full browser refresh clears the `New` pills.

Do not commit any temporary poll-interval change.

- [ ] **Step 5: Final status**

Run:

```bash
git status --short
```

Expected: clean tree after commits, or only intentional uncommitted verification notes.

