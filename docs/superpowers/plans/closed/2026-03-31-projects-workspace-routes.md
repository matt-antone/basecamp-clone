# Projects workspace: URL-first tabs implementation plan

> **STATUS: CLOSED** (2026-03-31) — URL-first routes are implemented via `ProjectsWorkspaceProvider` plus `ProjectsList` / `ProjectsBoard` / `ProjectsArchive` on `/`, `/flow`, and `/archive` (not the single `ProjectsWorkspacePage` + `view` prop described in early tasks). Optional `metadata` on `app/page.tsx` was not added (YAGNI). Do not dispatch new work from this document without authoring a new plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat Index, Flow (board), and Archive as first-class App Router routes (`/`, `/flow`, `/archive`) with a single shared workspace shell and no duplicate or hidden tab state.

**Architecture:** Routing already matches the target URLs: `app/page.tsx`, `app/flow/page.tsx`, and `app/archive/page.tsx` all render `ProjectsWorkspacePage`, which derives the active panel from `usePathname()` via `projectsViewTabFromPathname` in `lib/projects-view-path.ts`. Top navigation uses the same mapping through `projectsNavHighlight` in `app/header.tsx`. This plan tightens the boundary so each route file owns the view explicitly, removes dead/commented duplicate tab UI, aligns metadata, and adds regression tests where the contract changes.

**Tech Stack:** Next.js App Router, client workspace bootstrap (`createClientResource`), Vitest for `projects-view-path` and any new props/tests.

---

## File map

| File | Role |
|------|------|
| `app/page.tsx` | Home route; should pass `view="list"` (or rely on default) |
| `app/flow/page.tsx` | Flow route; `view="board"` |
| `app/archive/page.tsx` | Archive route; `view="archived"` |
| `app/flow/layout.tsx` | Metadata title "Flow" (exists) |
| `app/archive/layout.tsx` | Metadata title "Archive" (exists) |
| `components/projects/projects-workspace-page.tsx` | Shell + conditional views; accept optional `view` prop; remove commented tab bar |
| `lib/projects-view-path.ts` | Pathname → tab helpers; keep as source for `SiteHeader` |
| `app/header.tsx` | Global Projects / Project Board / Archive links (no change unless copy/URLs change) |
| `tests/unit/projects-view-path.test.ts` | Extend if helper behavior changes |

---

### Task 1: Add explicit `view` prop to `ProjectsWorkspacePage`

**Files:**
- Modify: `components/projects/projects-workspace-page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/flow/page.tsx`
- Modify: `app/archive/page.tsx`
- Test: add or extend `tests/unit/projects-workspace-page.test.tsx` (or minimal component test) if the team wants prop contract coverage; otherwise manual QA

- [x] **Step 1: Define the prop**

Add optional `view?: ProjectsViewTab` to the default export. Inside `ProjectsPageContent`, compute:

```ts
const activeTab = view ?? projectsViewTabFromPathname(pathname);
```

Keep pathname fallback so any stray reuse of the component still behaves. Document in a one-line comment that route `page.tsx` files SHOULD pass `view` for explicit ownership.

- [x] **Step 2: Wire each route**

```tsx
// app/page.tsx
import ProjectsWorkspacePage from "@/components/projects/projects-workspace-page";
export default function Page() {
  return <ProjectsWorkspacePage view="list" />;
}
```

```tsx
// app/flow/page.tsx
import ProjectsWorkspacePage from "@/components/projects/projects-workspace-page";
export default function Page() {
  return <ProjectsWorkspacePage view="board" />;
}
```

```tsx
// app/archive/page.tsx
import ProjectsWorkspacePage from "@/components/projects/projects-workspace-page";
export default function Page() {
  return <ProjectsWorkspacePage view="archived" />;
}
```

- [x] **Step 3: Run TypeScript check**

Run: `cd basecamp-clone && npx tsc --noEmit`  
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add app/page.tsx app/flow/page.tsx app/archive/page.tsx components/projects/projects-workspace-page.tsx
git commit -m "refactor(projects): pass explicit workspace view from each route"
```

---

### Task 2: Remove commented duplicate tab bar

**Files:**
- Modify: `components/projects/projects-workspace-page.tsx` (delete lines ~474–510, the commented `projectsWorkbenchBar` / `projectsViewSwitch` block)

**Rationale:** Primary navigation already lives in `header.tsx` (`SiteHeader` / `themeTopBarProjectsNav`). Keeping two tab strips causes drift. If in-page tabs are required later, restore a single component shared with the top bar tokens, not a copy-pasted block.

- [x] **Step 1: Delete the commented JSX block** (entire `{/* <div className="projectsWorkbenchBar"> ... */}` section).

- [x] **Step 2: Run lint on the touched file**

Run: `cd basecamp-clone && npx eslint components/projects/projects-workspace-page.tsx`  
Expected: clean.

- [x] **Step 3: Commit**

```bash
git add components/projects/projects-workspace-page.tsx
git commit -m "chore(projects): drop commented duplicate projects tab bar"
```

---

### Task 3: Optional metadata for the home projects index

**Files:**
- Modify: `app/page.tsx` OR add `app/(marketing)/` grouping only if the team accepts route-group churn (YAGNI default: **only** add `metadata` export to `app/page.tsx` if product wants a distinct title from root layout).

- [x] **Step 1 (optional):** Export `metadata` from `app/page.tsx` with `title: "Projects"` or template `%s | SiteName` consistent with `generateMetadata` in `app/layout.tsx`.

- [x] **Step 2: Commit** (if step 1 done)

---

### Task 4: Regression verification

- [x] **Step 1: Unit tests**

Run: `cd basecamp-clone && npx vitest run tests/unit/projects-view-path.test.ts`  
Expected: all pass.

- [x] **Step 2: Broader test pass (if available)**

Run: `npm run test`  
Expected: all pass.

- [x] **Step 3: Manual browser check**

1. Signed-in user: `/` shows list + filter shelf; `/flow` shows board columns; `/archive` shows archive tab.
2. Top bar highlights: Projects on `/`, Project Board on `/flow`, Archive on `/archive`.
3. Open a project `/[id]` — top bar highlights **none** for workspace tabs (`projectsNavHighlight` returns `null`).

---

## Out of scope (YAGNI unless requested)

- **Route groups** `app/(workspace)/` — only if multiple shared layouts are needed.
- **Lazy splitting** of `ArchiveTab` / `ProjectsBoardView` by route — measure bundle first.
- **Changing** `/flow` or `/archive` URL shapes — current paths match spec.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/closed/2026-03-31-projects-workspace-routes.md`.

**1. Subagent-Driven (recommended)** — one subagent per task; review between tasks.

**2. Inline execution** — run tasks sequentially in one session with checkpoints after Task 2 and Task 4.

No schema, env, or API contract changes.
