# Archive Tab — Client Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client filter dropdown to the Archive tab that mirrors the Board's filter markup, backed by archive-local state (no sharing with the Board/List filter).

**Architecture:** `ArchiveTab` owns its own `filterClientId` state (no prop, no workspace-context writes). Clients list comes from `useProjectsWorkspace()`. The fetch URL is built by a small pure helper so URL shape is unit-testable. No backend or global CSS changes — the Board's existing class names are reused.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest (node env + `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-04-16-archive-tab-client-filter-design.md`

---

## File Structure

- **Create** `lib/archive-projects-url.ts` — pure URL builder for `GET /projects/archived`. Isolates the query-param contract from the component so it can be tested without DOM/hooks.
- **Create** `tests/unit/archive-projects-url.test.ts` — unit tests for the URL builder.
- **Create** `tests/unit/archive-tab.test.tsx` — SSR markup tests for the selector UI (mocks `useProjectsWorkspace`).
- **Modify** `components/projects/archive-tab.tsx` — remove `filterClientId` prop, add local state, pull `clients` from workspace context, render selector, use new URL helper.
- **Modify** `components/projects/projects-archive.tsx` — stop passing `filterClientId` to `ArchiveTab`.

---

## Task 1: URL Builder Helper (TDD)

**Files:**
- Create: `lib/archive-projects-url.ts`
- Test: `tests/unit/archive-projects-url.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/archive-projects-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildArchiveProjectsUrl } from "@/lib/archive-projects-url";

describe("buildArchiveProjectsUrl", () => {
  it("omits clientId when null", () => {
    expect(buildArchiveProjectsUrl({ search: "", page: 1, clientId: null })).toBe(
      "/projects/archived?search=&page=1&limit=20"
    );
  });

  it("includes clientId when provided", () => {
    expect(
      buildArchiveProjectsUrl({ search: "", page: 1, clientId: "c-123" })
    ).toBe("/projects/archived?search=&page=1&limit=20&clientId=c-123");
  });

  it("includes search text verbatim (server handles trimming)", () => {
    expect(
      buildArchiveProjectsUrl({ search: "alpha", page: 2, clientId: null })
    ).toBe("/projects/archived?search=alpha&page=2&limit=20");
  });

  it("combines search and clientId", () => {
    expect(
      buildArchiveProjectsUrl({ search: "alpha", page: 3, clientId: "c-1" })
    ).toBe("/projects/archived?search=alpha&page=3&limit=20&clientId=c-1");
  });

  it("treats empty-string clientId as omitted", () => {
    expect(
      buildArchiveProjectsUrl({ search: "", page: 1, clientId: "" })
    ).toBe("/projects/archived?search=&page=1&limit=20");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/archive-projects-url.test.ts`
Expected: FAIL — `Cannot find module '@/lib/archive-projects-url'`.

- [ ] **Step 3: Implement the helper**

Create `lib/archive-projects-url.ts`:

```ts
export type ArchiveProjectsUrlOptions = {
  search: string;
  page: number;
  clientId: string | null;
  limit?: number;
};

/** Build the query URL for `GET /projects/archived`. `clientId` is omitted when falsy. */
export function buildArchiveProjectsUrl({
  search,
  page,
  clientId,
  limit = 20
}: ArchiveProjectsUrlOptions): string {
  const params = new URLSearchParams({
    search,
    page: String(page),
    limit: String(limit)
  });
  if (clientId) {
    params.set("clientId", clientId);
  }
  return `/projects/archived?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/archive-projects-url.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/archive-projects-url.ts tests/unit/archive-projects-url.test.ts
git commit -m "feat(projects): add buildArchiveProjectsUrl helper"
```

---

## Task 2: Rewire `ArchiveTab` — Local Filter State + Selector UI

**Files:**
- Modify: `components/projects/archive-tab.tsx`

- [ ] **Step 1: Remove the `filterClientId` prop and switch to local state + context**

Replace the import block and the component signature in `components/projects/archive-tab.tsx`.

Replace the existing imports at the top:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authedJsonFetch } from "@/lib/browser-auth";
import { buildArchiveProjectsUrl } from "@/lib/archive-projects-url";
import { OneShotButton } from "@/components/one-shot-button";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
import { ArchiveProjectRow, type ArchiveProjectItem } from "./archive-project-row";
```

Replace the `Props` type (drop `filterClientId`):

```tsx
type Props = {
  accessToken: string | null;
  onToken: (token: string | null) => void;
  onRestore: (project: ArchiveProjectItem) => Promise<void>;
  onOpenCreateDialog: () => void;
};
```

Replace the function signature and the first state declarations. Replace this block:

```tsx
export function ArchiveTab({ accessToken, onToken, onRestore, onOpenCreateDialog, filterClientId = null }: Props) {
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
```

with:

```tsx
export function ArchiveTab({ accessToken, onToken, onRestore, onOpenCreateDialog }: Props) {
  const { clients } = useProjectsWorkspace();
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [filterClientId, setFilterClientId] = useState<string | null>(null);
```

- [ ] **Step 2: Derive sorted client options with archived suffix**

Directly below the `filterClientId` `useState` line, add:

```tsx
const clientOptions = useMemo(
  () =>
    [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        label: c.archived_at ? `${c.name} (Archived)` : c.name
      })),
  [clients]
);
```

- [ ] **Step 3: Switch the fetch effect to use the URL helper**

Replace this block inside the fetch `useEffect`:

```tsx
    const params = new URLSearchParams({
      search: debouncedSearch,
      page: String(page),
      limit: "20"
    });
    if (filterClientId) {
      params.set("clientId", filterClientId);
    }

    authedJsonFetch({ accessToken, onToken, path: `/projects/archived?${params}` })
```

with:

```tsx
    authedJsonFetch({
      accessToken,
      onToken,
      path: buildArchiveProjectsUrl({ search: debouncedSearch, page, clientId: filterClientId })
    })
```

Leave the effect's dependency array `[debouncedSearch, page, accessToken, filterClientId, refreshKey]` unchanged — `filterClientId` now references local state, which is the intent.

- [ ] **Step 4: Render the client selector inside the filter toolbar**

Replace the existing `.projectsFilterControls` block:

```tsx
        <div className="projectsFilterControls">
          <label className="projectsSearchShell">
            <span className="projectsSearchLabel sr-only">Find</span>
            <input
              className="projectsSearchInput"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search archived projects"
              aria-label="Search archived projects"
            />
            <span className="projectsSearchHint">/</span>
          </label>
        </div>
```

with:

```tsx
        <div className="projectsFilterControls">
          <div className="projectsFilterToolbar">
            <label className="projectsFilterField projectsClientFilterField">
              <span className="projectsFilterLabel">Client</span>
              <select
                className="projectsClientSelect"
                value={filterClientId ?? ""}
                onChange={(e) => {
                  setFilterClientId(e.target.value || null);
                  setPage(1);
                }}
                aria-label="Filter archived projects by client"
              >
                <option value="">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="projectsFilterField projectsSearchShell">
              <span className="projectsSearchLabel sr-only">Find</span>
              <input
                className="projectsSearchInput"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search archived projects"
                aria-label="Search archived projects"
              />
              <span className="projectsSearchHint">/</span>
            </label>
          </div>
        </div>
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS — no errors. (If callers still pass `filterClientId`, the next task fixes the lone consumer.)

Note: there will be one remaining type error in `components/projects/projects-archive.tsx` until Task 3 lands. That is expected at the end of Step 5 — Task 3 resolves it.

- [ ] **Step 6: Commit**

```bash
git add components/projects/archive-tab.tsx
git commit -m "feat(archive): add client filter with archive-local state"
```

---

## Task 3: Stop Passing `filterClientId` from `ProjectsArchive`

**Files:**
- Modify: `components/projects/projects-archive.tsx`

- [ ] **Step 1: Remove the prop from the call site**

Replace this block in `components/projects/projects-archive.tsx`:

```tsx
  const { accessToken, setAccessToken, toggleArchive, openCreateDialog, domainAllowed, filterClientId } = useProjectsWorkspace();

  const viewport = domainAllowed ? (
    <ArchiveTab
      accessToken={accessToken}
      filterClientId={filterClientId}
      onToken={setAccessToken}
      onOpenCreateDialog={openCreateDialog}
      onRestore={async (project: ArchiveProjectItem) => {
        await toggleArchive({ ...project, archived: true } as Project);
      }}
    />
  ) : null;
```

with:

```tsx
  const { accessToken, setAccessToken, toggleArchive, openCreateDialog, domainAllowed } = useProjectsWorkspace();

  const viewport = domainAllowed ? (
    <ArchiveTab
      accessToken={accessToken}
      onToken={setAccessToken}
      onOpenCreateDialog={openCreateDialog}
      onRestore={async (project: ArchiveProjectItem) => {
        await toggleArchive({ ...project, archived: true } as Project);
      }}
    />
  ) : null;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS — no type errors anywhere.

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm vitest run`
Expected: PASS — everything green, including the new `archive-projects-url.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add components/projects/projects-archive.tsx
git commit -m "refactor(archive): stop threading filterClientId from workspace"
```

---

## Task 4: SSR Render Tests for `ArchiveTab` Selector UI

**Files:**
- Create: `tests/unit/archive-tab.test.tsx`

Test strategy: mirror the codebase's `renderToStaticMarkup` pattern. Mock `useProjectsWorkspace` to return a controllable `clients` array. Mock `@/lib/browser-auth` so the fetch effect (which doesn't fire during SSR anyway) has no module-level side effects. Static markup covers every case the spec asks to verify that is observable in rendered HTML.

The spec's interaction cases ("selecting issues a fetch", "selecting resets page") are already covered by Task 1's URL-builder tests plus the effect's dependency array including `filterClientId` and `page` — no jsdom test harness is added for this change. Manual QA in Task 5 verifies end-to-end behavior.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/archive-tab.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/types/client-record";

vi.mock("@/lib/browser-auth", () => ({
  authedJsonFetch: vi.fn(() => new Promise(() => {}))
}));

vi.mock("@/components/projects/projects-workspace-context", () => ({
  useProjectsWorkspace: () => ({ clients: mockClients })
}));

let mockClients: ClientRecord[] = [];

function makeClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: overrides.id ?? "client",
    name: overrides.name ?? "Client",
    code: overrides.code ?? "CLT",
    github_repos: [],
    domains: [],
    created_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    ...overrides
  };
}

async function renderArchiveTab() {
  const { ArchiveTab } = await import("@/components/projects/archive-tab");
  return renderToStaticMarkup(
    <ArchiveTab
      accessToken="test-token"
      onToken={() => {}}
      onRestore={async () => {}}
      onOpenCreateDialog={() => {}}
    />
  );
}

describe("ArchiveTab client filter", () => {
  it("renders the default 'All clients' option", async () => {
    mockClients = [];
    const markup = await renderArchiveTab();
    expect(markup).toContain('aria-label="Filter archived projects by client"');
    expect(markup).toContain(">All clients<");
  });

  it("renders client names sorted alphabetically from workspace context", async () => {
    mockClients = [
      makeClient({ id: "c-b", name: "Bravo" }),
      makeClient({ id: "c-a", name: "Acme" })
    ];
    const markup = await renderArchiveTab();
    const acmeIdx = markup.indexOf(">Acme<");
    const bravoIdx = markup.indexOf(">Bravo<");
    expect(acmeIdx).toBeGreaterThan(-1);
    expect(bravoIdx).toBeGreaterThan(-1);
    expect(acmeIdx).toBeLessThan(bravoIdx);
  });

  it("appends ' (Archived)' to archived client labels", async () => {
    mockClients = [
      makeClient({ id: "c-a", name: "Acme" }),
      makeClient({
        id: "c-z",
        name: "Zephyr",
        archived_at: "2026-03-01T00:00:00.000Z"
      })
    ];
    const markup = await renderArchiveTab();
    expect(markup).toContain(">Zephyr (Archived)<");
    expect(markup).toContain(">Acme<");
    expect(markup).not.toContain(">Acme (Archived)<");
  });

  it("renders the selector inside the filter toolbar markup", async () => {
    mockClients = [makeClient({ id: "c-a", name: "Acme" })];
    const markup = await renderArchiveTab();
    expect(markup).toContain('class="projectsFilterToolbar"');
    expect(markup).toContain('class="projectsFilterField projectsClientFilterField"');
    expect(markup).toContain('class="projectsClientSelect"');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run tests/unit/archive-tab.test.tsx`
Expected: PASS — 4 tests green.

If a test fails because `renderToStaticMarkup` throws (e.g. a non-mocked module calling browser APIs at import time), widen the `vi.mock` calls to cover the offending module and re-run. Do not add jsdom to the config.

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm vitest run`
Expected: PASS — every test green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/archive-tab.test.tsx
git commit -m "test(archive): cover client filter selector render"
```

---

## Task 5: Manual QA

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Verify Board → Archive isolation**

1. Open `/projects` (Board tab).
2. Pick a specific client in the Board's client filter.
3. Switch to the Archive tab.
4. Expected: Archive's client selector shows "All clients" (empty). Archive list is unfiltered by client.
5. Switch back to Board. Expected: the previously selected client is still active on the Board.

- [ ] **Step 3: Verify Archive filter behavior**

1. On the Archive tab, select a client from the dropdown.
2. Expected: the list re-fetches and shows only that client's archived projects; pagination resets to page 1.
3. Select "All clients". Expected: list re-fetches with no `clientId` param; full archived list returns.
4. Select a client with zero archived projects. Expected: the existing "No archived projects are parked here yet." empty state renders.

- [ ] **Step 4: Verify archived-client label**

1. In Settings → Clients, archive a client that has at least one archived project.
2. Return to the Archive tab. Expected: that client appears in the dropdown with the " (Archived)" suffix and is still selectable.

- [ ] **Step 5: Verify remount reset**

1. With a client selected on Archive, navigate away to `/projects` and back to Archive (full route change, not tab swap).
2. Expected: Archive tab mounts with "All clients" selected (no persistence).

- [ ] **Step 6: Stop the dev server and close out**

Ctrl+C the dev server. No commit — this task is verification only.

---

## Closing

After all tasks pass:

1. Confirm `pnpm tsc --noEmit` and `pnpm vitest run` are both green.
2. Move the spec and plan to `closed/`:

```bash
git mv docs/superpowers/specs/2026-04-16-archive-tab-client-filter-design.md docs/superpowers/specs/closed/
git mv docs/superpowers/plans/2026-04-16-archive-tab-client-filter.md docs/superpowers/plans/closed/
git commit -m "docs: archive archive-tab client filter spec and plan"
```
