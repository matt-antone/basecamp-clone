# Clients List — Active/Archived Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users on the Settings → Clients tab toggle between active and archived clients with a segmented-control tablist that shows counts per option.

**Architecture:** Pure client-side filter. A new helper module (`lib/clients-filter.ts`) owns the filter/partition logic. `app/settings/page.tsx` consumes the helper via `useMemo`, adds a `clientFilter` useState, renders a semantic `role="tablist"` with two `role="tab"` buttons, and iterates over `visibleClients` instead of `clients` in the existing clients list. No server, schema, route, or fetch changes.

**Tech Stack:** Next.js 15 App Router (React 19 client component), TypeScript, Vitest, `react-dom/server#renderToStaticMarkup` for tsx unit tests (existing convention — **no** React Testing Library in this repo).

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-04-13-clients-list-active-archived-filter-design.md`

## Correction vs. Spec

The spec's code sketch derives `useMemo` from `initial?.clients`. The actual component uses a `clients` useState initialized from `initial.clients` and updated by `loadClients()` after add/edit and by archive-status polling. **Derive from the `clients` state variable**, not `initial.clients`, so polling refreshes and dialog saves propagate through `useMemo` automatically.

## File Structure

- **Create** `lib/clients-filter.ts`
  Pure helpers: `isClientArchived`, `filterClientsByArchiveState`, `partitionClientsByArchiveState`. No React, no framework imports — just the `ClientRecord` type.
- **Create** `tests/unit/clients-filter.test.ts`
  Pure unit tests for the helper module (no tsx, no React).
- **Create** `tests/unit/settings-clients-filter.test.tsx`
  Static-markup render tests against `SettingsPageContent` covering tablist markup, counts, default tab, onboarding empty state, and filter-specific empty state.
- **Modify** `app/settings/page.tsx` (857 lines; changes localized to ~10 focused edits)
  - Add `useMemo` to React import.
  - Import the new helper.
  - Export `SettingsPageContent` so tests can import it.
  - Add `clientFilter` useState.
  - Add `useMemo` deriving `{ activeClients, archivedClients, visibleClients }` from `clients` and `clientFilter`.
  - In the clients tab render block, insert a `role="tablist"` segmented control above the list.
  - Switch the list iterator from `clients.map(...)` to `visibleClients.map(...)`.
  - Expand the existing empty state to branch: all-empty → onboarding copy; filter-empty → "No active clients." / "No archived clients.".

## Anchors (verified against current source)

- `app/settings/page.tsx:17` — React import line.
- `app/settings/page.tsx:16` — `import type { ClientRecord } from "@/lib/types/client-record";` (new helper import sits here).
- `app/settings/page.tsx:275` — `function SettingsPageContent({ initial }: { initial: SettingsBootstrap }) {` (needs `export`).
- `app/settings/page.tsx:281` — `const [clients, setClients] = useState<ClientRecord[]>(initial.clients);` (new `clientFilter` state sits directly after).
- `app/settings/page.tsx:583–660` — `{tab === "clients" && ...}` render block containing the tablist insert point and the `clients.map` to swap.
- `app/settings/page.tsx:593–595` — existing empty state (`clients.length === 0` branch, copy `"No clients yet. Add your first client..."`).
- `app/settings/page.tsx:597` — `clients.map((client) =>` — the single list iteration to swap to `visibleClients`.
- `lib/types/client-record.ts` — `ClientRecord.archived_at?: string | null` (predicate source).
- `vitest.config.ts` — `environment: "node"`, `include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`.

## Conventions

- Commit style: Conventional Commits (`feat:`, `test:`, `refactor:`) — matches existing history (`feat(mcp): ...`, `test(mcp): ...`).
- Test runner: `npx vitest run <path>` for targeted; `npm run test` for full.
- Vitest temp dir workaround used elsewhere: `TMPDIR=/tmp/codex-vitest npm run test` if the sandbox hits the ENOENT temp-dir issue.
- Each task ends in a commit.

---

## Task 1: Pure filter helper + unit tests

**Files:**
- Create: `lib/clients-filter.ts`
- Create: `tests/unit/clients-filter.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/unit/clients-filter.test.ts` with this exact content:

```ts
import { describe, expect, it } from "vitest";
import type { ClientRecord } from "@/lib/types/client-record";
import {
  filterClientsByArchiveState,
  isClientArchived,
  partitionClientsByArchiveState
} from "@/lib/clients-filter";

function makeClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: "client-id",
    name: "Client",
    code: "CLT",
    github_repos: [],
    domains: [],
    created_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    ...overrides
  };
}

const ACTIVE_A = makeClient({ id: "a", name: "Acme", code: "ACM", archived_at: null });
const ACTIVE_B = makeClient({ id: "b", name: "Bravo", code: "BRV" });
const ARCHIVED_C = makeClient({
  id: "c",
  name: "Charlie",
  code: "CHR",
  archived_at: "2026-03-01T12:00:00.000Z"
});
const ARCHIVED_D = makeClient({
  id: "d",
  name: "Delta",
  code: "DLT",
  archived_at: "2026-04-01T12:00:00.000Z"
});

describe("isClientArchived", () => {
  it("returns false when archived_at is null", () => {
    expect(isClientArchived(ACTIVE_A)).toBe(false);
  });

  it("returns false when archived_at is undefined", () => {
    expect(isClientArchived(makeClient({ archived_at: undefined }))).toBe(false);
  });

  it("returns true when archived_at is a non-empty ISO string", () => {
    expect(isClientArchived(ARCHIVED_C)).toBe(true);
  });
});

describe("filterClientsByArchiveState", () => {
  it("returns only active clients when filter is 'active'", () => {
    const result = filterClientsByArchiveState(
      [ACTIVE_A, ARCHIVED_C, ACTIVE_B, ARCHIVED_D],
      "active"
    );
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns only archived clients when filter is 'archived'", () => {
    const result = filterClientsByArchiveState(
      [ACTIVE_A, ARCHIVED_C, ACTIVE_B, ARCHIVED_D],
      "archived"
    );
    expect(result.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("returns an empty array when no clients match the filter", () => {
    expect(filterClientsByArchiveState([ACTIVE_A, ACTIVE_B], "archived")).toEqual([]);
    expect(filterClientsByArchiveState([ARCHIVED_C], "active")).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterClientsByArchiveState([], "active")).toEqual([]);
    expect(filterClientsByArchiveState([], "archived")).toEqual([]);
  });

  it("preserves input order within the filtered result", () => {
    const result = filterClientsByArchiveState(
      [ARCHIVED_C, ACTIVE_A, ARCHIVED_D, ACTIVE_B],
      "active"
    );
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("partitionClientsByArchiveState", () => {
  it("splits a mixed list into active and archived buckets", () => {
    const result = partitionClientsByArchiveState([
      ACTIVE_A,
      ARCHIVED_C,
      ACTIVE_B,
      ARCHIVED_D
    ]);
    expect(result.active.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.archived.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("returns empty arrays for empty input", () => {
    const result = partitionClientsByArchiveState([]);
    expect(result.active).toEqual([]);
    expect(result.archived).toEqual([]);
  });

  it("routes all clients into active when none are archived", () => {
    const result = partitionClientsByArchiveState([ACTIVE_A, ACTIVE_B]);
    expect(result.active).toHaveLength(2);
    expect(result.archived).toHaveLength(0);
  });

  it("routes all clients into archived when all are archived", () => {
    const result = partitionClientsByArchiveState([ARCHIVED_C, ARCHIVED_D]);
    expect(result.active).toHaveLength(0);
    expect(result.archived).toHaveLength(2);
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `cd basecamp-clone && npx vitest run tests/unit/clients-filter.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/clients-filter"` (module does not exist yet).

- [ ] **Step 1.3: Create the helper module**

Create `lib/clients-filter.ts` with this exact content:

```ts
import type { ClientRecord } from "@/lib/types/client-record";

export type ClientArchiveFilter = "active" | "archived";

export function isClientArchived(client: ClientRecord): boolean {
  return Boolean(client.archived_at);
}

export function filterClientsByArchiveState(
  clients: readonly ClientRecord[],
  filter: ClientArchiveFilter
): ClientRecord[] {
  const wantsArchived = filter === "archived";
  return clients.filter((client) => isClientArchived(client) === wantsArchived);
}

export function partitionClientsByArchiveState(
  clients: readonly ClientRecord[]
): { active: ClientRecord[]; archived: ClientRecord[] } {
  const active: ClientRecord[] = [];
  const archived: ClientRecord[] = [];
  for (const client of clients) {
    if (isClientArchived(client)) {
      archived.push(client);
    } else {
      active.push(client);
    }
  }
  return { active, archived };
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `cd basecamp-clone && npx vitest run tests/unit/clients-filter.test.ts`

Expected: PASS — 13 tests green across 3 describe blocks. If ENOENT on tmp dir, rerun with `TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/clients-filter.test.ts`.

- [ ] **Step 1.5: Commit**

```bash
cd basecamp-clone
git add lib/clients-filter.ts tests/unit/clients-filter.test.ts
git commit -m "feat(clients-filter): add pure active/archived filter helpers with tests"
```

---

## Task 2: Wire filter into Settings page + render test

**Files:**
- Modify: `app/settings/page.tsx:17` (React import), `:16–17` area (new helper import), `:275` (export), `:281+` (new state), `:301±` (new useMemo), `:583–660` (tablist + render swap + empty states)
- Create: `tests/unit/settings-clients-filter.test.tsx`

### Step 2.1: Add the React Testing harness test first

- [ ] **Step 2.1: Write the failing render test**

Create `tests/unit/settings-clients-filter.test.tsx` with this exact content:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPageContent } from "@/app/settings/page";
import type { ClientRecord } from "@/lib/types/client-record";

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

const activeClient = (suffix: string, name: string) =>
  makeClient({ id: `a-${suffix}`, code: `A${suffix}`, name });

const archivedClient = (suffix: string, name: string) =>
  makeClient({
    id: `z-${suffix}`,
    code: `Z${suffix}`,
    name,
    archived_at: "2026-03-01T00:00:00.000Z"
  });

const BASE_INITIAL = {
  token: "test-token",
  googleAvatarUrl: "",
  status: "",
  profile: {
    email: "",
    firstName: "",
    lastName: "",
    avatarUrl: "",
    jobTitle: "",
    timezone: "",
    bio: ""
  },
  siteSettings: {
    siteTitle: "",
    logoUrl: "",
    defaultHourlyRateUsd: "150.00"
  }
};

describe("SettingsPageContent clients filter", () => {
  it("renders a tablist with active and archived counts", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [
            activeClient("1", "Acme"),
            activeClient("2", "Bravo"),
            activeClient("3", "Charlie"),
            archivedClient("1", "Delta")
          ]
        }}
      />
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Client filter"');
    expect(markup).toContain("Active ");
    expect(markup).toContain("(3)");
    expect(markup).toContain("Archived ");
    expect(markup).toContain("(1)");
  });

  it("defaults to the active tab with aria-selected=true on Active and shows only active clients", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [activeClient("1", "Acme Active"), archivedClient("1", "Bravo Archived")]
        }}
      />
    );
    expect(markup).toContain("Acme Active");
    expect(markup).not.toContain("Bravo Archived");
    expect(markup).toMatch(/aria-selected="true"[^>]*>\s*Active\s/);
    expect(markup).toMatch(/aria-selected="false"[^>]*>\s*Archived\s/);
  });

  it("shows the onboarding empty state when there are zero clients total", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent initial={{ ...BASE_INITIAL, clients: [] }} />
    );
    expect(markup).toContain("No clients yet. Add your first client");
  });

  it("shows 'No active clients.' when every client is archived and the Active tab is default", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{ ...BASE_INITIAL, clients: [archivedClient("1", "Bravo Archived")] }}
      />
    );
    expect(markup).toContain("No active clients.");
    expect(markup).not.toContain("Bravo Archived");
    expect(markup).toContain("(0)");
    expect(markup).toContain("(1)");
  });
});
```

- [ ] **Step 2.2: Run the render test to verify it fails**

Run: `cd basecamp-clone && npx vitest run tests/unit/settings-clients-filter.test.tsx`

Expected: FAIL — either `SettingsPageContent is not exported from "@/app/settings/page"` or assertions on `role="tablist"` / counts / `aria-selected` miss. Both failure modes are fine — Step 2.3 onward fixes them.

### Step 2.3: Add the React import

- [ ] **Step 2.3: Update the React import to include `useMemo`**

At `app/settings/page.tsx:17`, replace:

```tsx
import { useEffect, useRef, useState } from "react";
```

with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

### Step 2.4: Import the helper

- [ ] **Step 2.4: Import `partitionClientsByArchiveState`**

Immediately after `import type { ClientRecord } from "@/lib/types/client-record";` (current `app/settings/page.tsx:16`), add:

```tsx
import { partitionClientsByArchiveState } from "@/lib/clients-filter";
```

### Step 2.5: Export SettingsPageContent

- [ ] **Step 2.5: Export `SettingsPageContent`**

At `app/settings/page.tsx:275`, replace:

```tsx
function SettingsPageContent({ initial }: { initial: SettingsBootstrap }) {
```

with:

```tsx
export function SettingsPageContent({ initial }: { initial: SettingsBootstrap }) {
```

### Step 2.6: Add the `clientFilter` state

- [ ] **Step 2.6: Add `clientFilter` useState**

Directly after the line:

```tsx
  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
```

(currently `app/settings/page.tsx:281`), insert:

```tsx
  const [clientFilter, setClientFilter] = useState<"active" | "archived">("active");
```

### Step 2.7: Add the derived `useMemo`

- [ ] **Step 2.7: Derive `activeClients`, `archivedClients`, `visibleClients`**

Add the following `useMemo` block immediately after the `clientFilter` state line you just inserted in Step 2.6:

```tsx
  const { activeClients, archivedClients, visibleClients } = useMemo(() => {
    const { active, archived } = partitionClientsByArchiveState(clients);
    return {
      activeClients: active,
      archivedClients: archived,
      visibleClients: clientFilter === "active" ? active : archived
    };
  }, [clients, clientFilter]);
```

### Step 2.8: Replace the clients render block

- [ ] **Step 2.8: Add the tablist and swap the iterator + empty states**

In `app/settings/page.tsx`, locate the existing block (currently lines ~592–650) that starts with:

```tsx
          {clients.length === 0 ? (
            <p className="status">No clients yet. Add your first client to start assigning projects.</p>
          ) : (
            <ul className="settingsClientList">
              {clients.map((client) => (
```

and ends with the closing `</ul>` / `)}` of that conditional. Replace the entire conditional (from `{clients.length === 0 ? (` through its matching `)}`) with:

```tsx
          <div
            role="tablist"
            aria-label="Client filter"
            className="settingsClientFilter"
          >
            <button
              type="button"
              role="tab"
              aria-selected={clientFilter === "active"}
              className={clientFilter === "active" ? "tabButton activeTab" : "tabButton"}
              onClick={() => setClientFilter("active")}
            >
              Active <span className="settingsClientFilterCount">({activeClients.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={clientFilter === "archived"}
              className={clientFilter === "archived" ? "tabButton activeTab" : "tabButton"}
              onClick={() => setClientFilter("archived")}
            >
              Archived <span className="settingsClientFilterCount">({archivedClients.length})</span>
            </button>
          </div>

          {clients.length === 0 ? (
            <p className="status">No clients yet. Add your first client to start assigning projects.</p>
          ) : visibleClients.length === 0 ? (
            <p className="status">
              {clientFilter === "active" ? "No active clients." : "No archived clients."}
            </p>
          ) : (
            <ul className="settingsClientList">
              {visibleClients.map((client) => (
                <li key={client.id} className="settingsClientRow">
                  <div className="settingsClientRowBody">
                    <div className="settingsClientRowMain">
                      <strong>{client.code}</strong>
                      <span>{client.name}</span>
                    </div>
                    <div className="settingsClientMeta">
                      <span className={`settingsClientStatus settingsClientStatus-${getClientArchiveStatus(client)}`}>
                        {getClientArchiveSummary(client)}
                      </span>
                      {isClientArchiveRunning(client) ? (
                        <div className="settingsClientProgress" aria-live="polite">
                          <span className="settingsClientProgressBar" aria-hidden="true" />
                          <span>Large Dropbox moves can take a few minutes. Status updates every 2 seconds.</span>
                        </div>
                      ) : null}
                      {client.archive_error ? (
                        <p className="status settingsDialogError" role="alert">
                          {client.archive_error}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="settingsClientActions">
                    <OneShotButton
                      type="button"
                      className="secondary"
                      onClick={() => openEditClientDialog(client)}
                      disabled={!token || isClientArchiveRunning(client)}
                      aria-label={`Edit ${client.name}`}
                    >
                      Edit
                    </OneShotButton>
                    <OneShotButton
                      type="button"
                      className="secondary"
                      onClick={() => submitClientArchiveAction(client).catch((error) => setStatus(error.message))}
                      disabled={!token || isClientArchiveRunning(client)}
                    >
                      {getClientArchiveButtonLabel(client)}
                    </OneShotButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
```

Notes for the implementing agent:
- The only real logic change inside the `<ul>` is `clients.map` → `visibleClients.map`. Every `<li>` child is identical to the current code — copy-paste verified. Do not edit `getClientArchiveStatus`, `getClientArchiveSummary`, `isClientArchiveRunning`, `openEditClientDialog`, `submitClientArchiveAction`, or `OneShotButton` usage.
- Do **not** rename or remove the existing onboarding empty state — it stays as the `clients.length === 0` branch so users with zero clients keep the "Add your first client" copy.
- Leave `const pollingIds = clients.filter(...)` (currently `app/settings/page.tsx:446`) pointing at the full `clients` array — polling must consider every running archive, including ones the user can't see in the current tab.
- Leave `clients.find((client) => client.id === clientEditingId)` (currently `app/settings/page.tsx:301`) unchanged — edit dialog must resolve against the full list.

### Step 2.9: Rerun the render test

- [ ] **Step 2.9: Run `tests/unit/settings-clients-filter.test.tsx` and verify it passes**

Run: `cd basecamp-clone && npx vitest run tests/unit/settings-clients-filter.test.tsx tests/unit/clients-filter.test.ts`

Expected: PASS — all render assertions + all 13 helper tests green. If ENOENT on tmp dir, rerun with `TMPDIR=/tmp/codex-vitest ...` prefix.

If the render test fails on `(3)` / `(1)` count matching, verify Step 2.7's `useMemo` is deriving from `clients` (not `initial.clients`) and Step 2.8's JSX uses `activeClients.length` / `archivedClients.length` from destructuring.

### Step 2.10: Commit

- [ ] **Step 2.10: Commit**

```bash
cd basecamp-clone
git add app/settings/page.tsx tests/unit/settings-clients-filter.test.tsx
git commit -m "feat(settings): filter clients list by active/archived with count tabs"
```

---

## Task 3: Verification sweep

**Files:** none modified (read-only verification).

### Step 3.1: Targeted regression run

- [ ] **Step 3.1: Run existing client-area tests to confirm no regressions**

Run: `cd basecamp-clone && npx vitest run tests/unit/clients-filter.test.ts tests/unit/settings-clients-filter.test.tsx tests/unit/clients-route.test.ts tests/unit/clients-patch-route.test.ts tests/unit/clients-id-route.test.ts tests/unit/clients-archive-route.test.ts`

Expected: PASS on all six files. Route tests should be untouched — they never imported the new helper or `SettingsPageContent`.

### Step 3.2: Full suite run

- [ ] **Step 3.2: Run the whole Vitest suite**

Run: `cd basecamp-clone && npm run test`

If the sandbox throws an ENOENT inside Vitest's tmp dir, rerun as: `cd basecamp-clone && TMPDIR=/tmp/codex-vitest npm run test`

Expected: green overall. Report any failing file paths back with their error lines — if a failure is unrelated to clients/settings, flag it in the handoff rather than auto-fixing.

### Step 3.3: TypeScript check on touched files

- [ ] **Step 3.3: TypeScript check via Next build typecheck**

Run: `cd basecamp-clone && npx tsc --noEmit -p .`

Expected: no new errors in `app/settings/page.tsx`, `lib/clients-filter.ts`, `tests/unit/clients-filter.test.ts`, or `tests/unit/settings-clients-filter.test.tsx`. Pre-existing errors unrelated to this feature can be reported and left alone.

### Step 3.4: Manual QA checklist (dev server smoke)

- [ ] **Step 3.4: Run dev server and walk the manual checklist**

```bash
cd basecamp-clone && npm run dev
```

Then, in a browser at `/settings` → Clients tab:

1. On load: Active tab is selected; active clients are listed; Archived tab shows correct `(N)` count.
2. Click Archived: list swaps to archived clients; `aria-selected` flips; counts unchanged.
3. Click Active again: returns to active list.
4. Click **Archive** on an active client → row stays in Active while polling shows "Archiving…". After the archive completes (or the next bootstrap refresh), the row leaves Active and the Archived count ticks up. No auto-switch.
5. From Archived, click **Restore** on an archived client → row stays in Archived while polling shows "Restoring…", then leaves when `archived_at` clears.
6. Toggle to a filter with no matching rows → verify copy reads `"No active clients."` or `"No archived clients."` as appropriate.
7. With zero clients total (fresh workspace), verify the onboarding copy `"No clients yet. Add your first client..."` still appears.
8. From Archived tab, click Add client → dialog opens, add a new client → new row appears in Active (not Archived). No auto-switch.

Report any discrepancy; do **not** refactor archive/restore/polling logic to "fix" UX quirks — the spec explicitly keeps those behaviors as-is.

- [ ] **Step 3.5: No commit**

Step 3 is verification only. If Step 3.2 or 3.3 uncovers a real regression caused by Task 2, fix it in a new commit on the same task scope rather than rolling up additional work.

---

## Orchestrator Final Verification (outside subagent scope)

After all tasks merge, the orchestrator (not a subagent) **MUST** still run the user's global post-task QA loop for web work:

1. Dispatch the `web-test-engineer` agent to review/augment tests for this feature.
2. Dispatch the `qa-standards-auditor` agent to audit the change against QA standards.

Per repo CLAUDE.md these must not be skipped.

---

## Handoff Notes

- **No schema changes.** No migration, no env vars, no API contract changes.
- **No route changes.** `/clients` and `/clients/:id/...` remain untouched.
- **No new runtime dependencies.** Uses existing React 19 + Vitest + `react-dom/server`.
- **Server/client boundary:** The helper is plain TypeScript; `app/settings/page.tsx` already has `"use client"` at the top. Adding `export` to `SettingsPageContent` does not change that directive or create a new server/client crossing.
- **Polling still covers every archive-in-progress row** across both tabs because `pollingIds` is computed from the full `clients` state, not `visibleClients`.

## Self-Review Notes

- Spec coverage check: filter state, useMemo derivation, default "active", segmented control w/ counts, `role="tablist"`/`role="tab"`/`aria-selected`, empty states for both filters, preservation of archive/restore/polling behavior, and the "extract helper and unit-test it" testing fallback — all represented in Tasks 1–2.
- Placeholder scan: no `TBD`, no "add appropriate error handling", no "similar to Task N". Every code step has complete code inline.
- Type/name consistency: `ClientArchiveFilter`, `filterClientsByArchiveState`, `partitionClientsByArchiveState`, `isClientArchived` defined in Task 1 and used by identical names in Task 2. `clientFilter` / `setClientFilter` / `visibleClients` / `activeClients` / `archivedClients` named identically in state, useMemo, render, and tests.
- Known non-coverage: interactive click → tab switch is tested only at the pure-helper level (Task 1) because the repo has no RTL/jsdom. This is the spec's sanctioned fallback and is called out in Step 3.4's manual QA.
