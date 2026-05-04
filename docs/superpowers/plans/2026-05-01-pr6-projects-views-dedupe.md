# PR 6: `projects-board.tsx ↔ projects-list.tsx` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 4 clone groups (~173 lines) between `components/projects/projects-board.tsx` and `components/projects/projects-list.tsx` by extracting (a) a `useProjectsFilterShelf(projects)` hook owning the search debounce, refresh effect, and derived client filter options, and (b) a `<ProjectsFilterShelf>` presentational component owning the filter/sort/search JSX. After this PR, `fallow dupes` reports zero clone groups across these two files.

**Architecture:**
- New `components/projects/use-projects-filter-shelf.ts` — hook reading `useProjectsWorkspace()` and returning the search state machine (searchValue/setSearchValue, effectiveSearch, searchInputRef, handleCommandRowKeyDown), the filter sort/client passthroughs, and the memoized `derivedClientOptions` + `clientFilterDisabled`. Takes the `projects` array as input so each caller can pass either `activeProjects` (board) or the post-status-filter `visibleProjects` (list).
- New `components/projects/projects-filter-shelf.tsx` — presentational component rendering the `<section className="projectsFilterShelf">` markup. Takes the full set of filter shelf props plus `resultCount` + `clientCount` for the meta line.
- `components/projects/projects-board.tsx` — drops 4 effects, 3 derived values, and the workbench JSX block. Keeps board-specific state (drag/drop, justMoved flash) and handlers (`handleMove`, `handleSendToBilling`, drag handlers).
- `components/projects/projects-list.tsx` — drops the same 4 effects, 3 derived values, and the workbench JSX block. Keeps list-specific state (statusFilter, highlightedProjectId, statusSummaries, keyboardNavigableProjects) and effects (global "/" keyboard shortcut, scroll-into-view, status filter behavior).

**Why a hook + a presentational component (vs one or the other):**
- Hook alone: each route still inlines the same ~50-line JSX block. Fallow would still flag the JSX as a clone group.
- Component alone: each route still has the same ~30-line search debounce / refresh / derive client options block. Fallow would still flag the logic as a clone group.
- Both: the hook owns the state machine, the component owns the markup, each route's container becomes only its differentiated concerns (drag/drop or status filter + keyboard nav).

**Tech Stack:** React (use client), TypeScript, Vitest.

**Refactor discipline:** No tests cover the container components directly (`projects-board.tsx`, `projects-list.tsx`). The view components (`projects-board-view.tsx`, `projects-list-view.tsx`) have tests, but those are downstream of the props produced here — they pass through unchanged. Manual verification is critical: `pnpm dev` and click through the projects board and projects list, exercise search debounce, client filter, sort change, and (list only) the status filter / keyboard nav. No new tests are added in this PR; the hook is a thin reorganization of existing effects, not new behavior.

---

### Task 1: Extract `useProjectsFilterShelf` hook + `<ProjectsFilterShelf>` component, then refactor both container components

**Files:**
- Create: `components/projects/use-projects-filter-shelf.ts`
- Create: `components/projects/projects-filter-shelf.tsx`
- Modify: `components/projects/projects-board.tsx` (replace contents)
- Modify: `components/projects/projects-list.tsx` (replace contents)

**Reference — current shape (in main):**
- `projects-board.tsx`: 242 lines. Lines 30–88 contain: search state machine (3 useState + 2 useEffect for debounce + 1 useEffect for refresh + escape handler + searchInputRef + hasMountedQueryEffectRef). Lines 65–82 contain: `derivedClientOptions` (memo), `derivedClientIds` (memo), `clientFilterDisabled`, `visibleClients`. Lines 158–213 contain the workbench JSX (filter shelf section + results meta).
- `projects-list.tsx`: 281 lines. Lines 36–115 mirror the search state machine and refresh effect. Lines 167–184 mirror the derived client options. Lines 186–241 mirror the workbench JSX (with the same filter shelf section + results meta). The list also has its own `pulseRow` (status filter chips) sibling, kept inside `projects-list.tsx`.

The 4 fallow clone groups call out specific overlapping ranges; consolidating these three concerns (search state, client options, shelf JSX) into the hook + component eliminates all 4.

- [ ] **Step 1: Verify on the worktree branch and baseline is green**

You should already be in `.worktrees/projects-views-dedupe` on branch `refactor/projects-views-dedupe`.

Run: `git branch --show-current`
Expected: `refactor/projects-views-dedupe`.

Run: `pnpm test`
Expected: 513 passed, 3 skipped.

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 2 "projects-board.tsx\|projects-list.tsx" | head -10`
Expected: at least 4 clone groups across the two files.

- [ ] **Step 2: Create the hook at `components/projects/use-projects-filter-shelf.ts`**

Create the file with this exact content:

```ts
"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  useProjectsWorkspace,
  type Project,
  type ProjectSort
} from "@/components/projects/projects-workspace-context";

export function useProjectsFilterShelf(projects: Project[]) {
  const {
    activeSearch,
    setActiveSearch,
    filterClientId,
    setFilterClientId,
    projectSort,
    setProjectSort,
    refreshProjects,
    getProjectClientLabel
  } = useProjectsWorkspace();

  const [searchValue, setSearchValue] = useState(activeSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(activeSearch);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasMountedQueryEffectRef = useRef(false);

  const trimmedSearchValue = debouncedSearch.trim();
  const effectiveSearch = trimmedSearchValue.length >= 2 ? trimmedSearchValue : "";

  useEffect(() => {
    setSearchValue(activeSearch);
    setDebouncedSearch(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    if (!hasMountedQueryEffectRef.current) {
      hasMountedQueryEffectRef.current = true;
      return;
    }

    setActiveSearch(effectiveSearch);
    void refreshProjects({
      clientId: filterClientId,
      search: effectiveSearch,
      sort: projectSort
    });
  }, [effectiveSearch, filterClientId, projectSort, refreshProjects, setActiveSearch]);

  const derivedClientOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const project of projects) {
      const cid = project.client_id?.trim();
      if (!cid) continue;
      if (!byId.has(cid)) {
        byId.set(cid, { id: cid, label: getProjectClientLabel(project) });
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, getProjectClientLabel]);

  const derivedClientIds = useMemo(
    () => new Set(derivedClientOptions.map((option) => option.id)),
    [derivedClientOptions]
  );

  const clientFilterDisabled = Boolean(filterClientId && !derivedClientIds.has(filterClientId));

  function handleCommandRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setSearchValue("");
      searchInputRef.current?.blur();
    }
  }

  return {
    searchValue,
    setSearchValue,
    effectiveSearch,
    searchInputRef,
    derivedClientOptions,
    clientFilterDisabled,
    filterClientId,
    setFilterClientId,
    projectSort,
    setProjectSort: setProjectSort as (sort: ProjectSort) => void,
    handleCommandRowKeyDown
  };
}
```

- [ ] **Step 3: Create the presentational component at `components/projects/projects-filter-shelf.tsx`**

Create the file with this exact content:

```tsx
"use client";

import type { KeyboardEvent, RefObject } from "react";
import type { ProjectSort } from "@/components/projects/projects-workspace-context";

type Props = {
  searchValue: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  effectiveSearchActive: boolean;
  filterClientId: string | null;
  setFilterClientId: (id: string | null) => void;
  derivedClientOptions: { id: string; label: string }[];
  clientFilterDisabled: boolean;
  projectSort: ProjectSort;
  setProjectSort: (sort: ProjectSort) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  resultCount: number;
  clientCount: number;
};

export function ProjectsFilterShelf(props: Props) {
  return (
    <section className="projectsFilterShelf" onKeyDown={props.onKeyDown}>
      <div className="projectsFilterControls">
        <div className="projectsFilterToolbar">
          <label className="projectsFilterField projectsClientFilterField">
            <span className="projectsFilterLabel">Client</span>
            <select
              className="projectsClientSelect"
              value={props.filterClientId ?? ""}
              onChange={(event) => props.setFilterClientId(event.target.value || null)}
              aria-label="Filter projects by client"
              disabled={props.clientFilterDisabled}
            >
              <option value="">All clients</option>
              {props.derivedClientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
          <label className="projectsFilterField projectsClientFilterField">
            <span className="projectsFilterLabel">Sort</span>
            <select
              className="projectsClientSelect"
              value={props.projectSort}
              onChange={(event) => props.setProjectSort(event.target.value as ProjectSort)}
              aria-label="Sort projects"
              disabled={props.effectiveSearchActive}
            >
              <option value="title">Title A–Z</option>
              <option value="created">Newest First</option>
            </select>
          </label>
          <label className="projectsFilterField projectsSearchShell">
            <span className="projectsSearchLabel sr-only">Find</span>
            <input
              ref={props.searchInputRef}
              className="projectsSearchInput"
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="Search projects, discussions, or files"
              aria-label="Search projects"
            />
            <span className="projectsSearchHint">/</span>
          </label>
        </div>
      </div>
      <div className="projectsResultsMeta">
        <p className="projectsResultsNote">
          {props.resultCount} showing across {props.clientCount} clients
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Replace `components/projects/projects-board.tsx`**

Overwrite the entire file with:

```tsx
"use client";

import { ProjectsBoardView } from "@/components/projects/projects-board-view";
import { ProjectsFilterShelf } from "@/components/projects/projects-filter-shelf";
import { useProjectsFilterShelf } from "@/components/projects/use-projects-filter-shelf";
import type { ProjectColumn } from "@/components/projects/projects-workspace-context";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import { type DragEvent, useEffect, useRef, useState } from "react";

export function ProjectsBoard() {
  const {
    activeProjects,
    projectColumns,
    renderProjectTitle,
    authedFetch,
    moveProject,
    toggleArchive,
    openCreateDialog,
    setStatus,
    domainAllowed,
    getProjectClientLabel,
    filterClientId,
    activeSearch,
    projectSort,
    refreshProjects
  } = useProjectsWorkspace();

  const filterShelf = useProjectsFilterShelf(activeProjects);

  const visibleClients = new Set(activeProjects.map((project) => getProjectClientLabel(project))).size;

  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ProjectColumn | null>(null);
  const [justMovedProjectId, setJustMovedProjectId] = useState<string | null>(null);
  const [justUpdatedColumn, setJustUpdatedColumn] = useState<ProjectColumn | null>(null);
  const moveFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
    };
  }, []);

  async function handleMove(projectId: string, column: ProjectColumn) {
    try {
      await moveProject(projectId, column);
      setJustMovedProjectId(projectId);
      setJustUpdatedColumn(column);
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
      moveFlashTimeoutRef.current = setTimeout(() => {
        setJustMovedProjectId(null);
        setJustUpdatedColumn(null);
      }, 900);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to move project");
    }
  }

  async function handleSendToBilling(projectId: string) {
    await authedFetch(`/projects/${projectId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "billing" })
    });
    await refreshProjects({ clientId: filterClientId, search: activeSearch, sort: projectSort });
  }

  function handleBoardColumnDragOver(event: DragEvent<HTMLElement>, column: ProjectColumn) {
    event.preventDefault();
    setDragOverColumn(column);
  }

  function handleBoardColumnDragLeave(column: ProjectColumn) {
    setDragOverColumn((current) => (current === column ? null : current));
  }

  function handleBoardColumnDrop(event: DragEvent<HTMLElement>, column: ProjectColumn) {
    event.preventDefault();
    const draggedProjectId = event.dataTransfer.getData("text/plain");
    setDragOverColumn(null);
    setDraggingProjectId(null);
    if (!draggedProjectId) return;
    void handleMove(draggedProjectId, column);
  }

  function handleBoardCardDragStart(event: DragEvent<HTMLLIElement>, projectId: string) {
    event.dataTransfer.setData("text/plain", projectId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingProjectId(projectId);
  }

  function handleBoardCardDragEnd() {
    setDraggingProjectId(null);
    setDragOverColumn(null);
  }

  const workbench = domainAllowed ? (
    <ProjectsFilterShelf
      searchValue={filterShelf.searchValue}
      searchInputRef={filterShelf.searchInputRef}
      onSearchChange={filterShelf.setSearchValue}
      effectiveSearchActive={filterShelf.effectiveSearch.length >= 2}
      filterClientId={filterShelf.filterClientId}
      setFilterClientId={filterShelf.setFilterClientId}
      derivedClientOptions={filterShelf.derivedClientOptions}
      clientFilterDisabled={filterShelf.clientFilterDisabled}
      projectSort={filterShelf.projectSort}
      setProjectSort={filterShelf.setProjectSort}
      onKeyDown={filterShelf.handleCommandRowKeyDown}
      resultCount={activeProjects.length}
      clientCount={visibleClients}
    />
  ) : null;

  const viewport = domainAllowed ? (
    <ProjectsBoardView
      items={activeProjects}
      projectColumns={projectColumns}
      dragOverColumn={dragOverColumn}
      draggingProjectId={draggingProjectId}
      justMovedProjectId={justMovedProjectId}
      justUpdatedColumn={justUpdatedColumn}
      renderProjectTitle={renderProjectTitle}
      onColumnDragOver={handleBoardColumnDragOver}
      onColumnDragLeave={handleBoardColumnDragLeave}
      onColumnDrop={handleBoardColumnDrop}
      onCardDragStart={handleBoardCardDragStart}
      onCardDragEnd={handleBoardCardDragEnd}
      onSendToBilling={(project) =>
        handleSendToBilling(project.id).catch((error) =>
          setStatus(error instanceof Error ? error.message : "Failed to send project to billing")
        )
      }
      onArchiveProject={(project) =>
        toggleArchive(project).catch((error) => setStatus(error instanceof Error ? error.message : "Archive failed"))
      }
      onOpenCreateDialog={openCreateDialog}
    />
  ) : null;

  return <ProjectsWorkspaceShell showHero={false} workbench={workbench} viewport={viewport} />;
}
```

Notes:
- The `KeyboardEvent` and `useMemo` imports from the original are no longer needed (handled by the hook).
- The `setStatus` import path stays via `useProjectsWorkspace`.

- [ ] **Step 5: Replace `components/projects/projects-list.tsx`**

Overwrite the entire file with:

```tsx
"use client";

import { OneShotButton } from "@/components/one-shot-button";
import { ProjectsFilterShelf } from "@/components/projects/projects-filter-shelf";
import { ProjectsListView } from "@/components/projects/projects-list-view";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import {
  useProjectsWorkspace,
  type Project,
  type ProjectColumn
} from "@/components/projects/projects-workspace-context";
import { useProjectsFilterShelf } from "@/components/projects/use-projects-filter-shelf";
import { normalizeProjectColumn } from "@/lib/project-utils";
import { type FocusEvent, useEffect, useMemo, useState } from "react";

type StatusFilter = "all" | ProjectColumn;

export function ProjectsList() {
  const {
    domainAllowed,
    activeProjects,
    projectColumns,
    openCreateDialog,
    renderProjectTitle,
    getProjectStatusLabel,
    getProjectClientLabel,
    activeSearch
  } = useProjectsWorkspace();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);

  function projectMatchesStatus(project: Project) {
    return statusFilter === "all" ? true : normalizeProjectColumn(project) === statusFilter;
  }

  const filteredActiveProjects = useMemo(
    () => activeProjects.filter((project) => projectMatchesStatus(project)),
    [activeProjects, statusFilter]
  );

  const filterShelf = useProjectsFilterShelf(filteredActiveProjects);

  const keyboardNavigableProjects = useMemo(
    () =>
      filteredActiveProjects
        .slice()
        .sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)),
    [filteredActiveProjects]
  );

  const statusSummaries = useMemo(() => {
    const total = Math.max(filteredActiveProjects.length, 1);
    return projectColumns.map((column) => {
      const count = filteredActiveProjects.filter((project) => normalizeProjectColumn(project) === column.key).length;
      return {
        ...column,
        count,
        fillPercent: `${Math.round((count / total) * 100)}%`
      };
    });
  }, [filteredActiveProjects, projectColumns]);

  useEffect(() => {
    if (!keyboardNavigableProjects.length) {
      setHighlightedProjectId(null);
      return;
    }
    setHighlightedProjectId((current) =>
      current && keyboardNavigableProjects.some((project) => project.id === current) ? current : null
    );
  }, [keyboardNavigableProjects]);

  useEffect(() => {
    if (!highlightedProjectId) return;
    const element = document.querySelector<HTMLElement>(`[data-project-id="${highlightedProjectId}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [highlightedProjectId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        filterShelf.searchInputRef.current?.focus();
        return;
      }

      if (inEditable || !keyboardNavigableProjects.length) return;

      const currentIndex = keyboardNavigableProjects.findIndex((project) => project.id === highlightedProjectId);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, keyboardNavigableProjects.length - 1) : 0;
        setHighlightedProjectId(keyboardNavigableProjects[nextIndex].id);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.max(currentIndex - 1, 0) : 0;
        setHighlightedProjectId(keyboardNavigableProjects[nextIndex].id);
      } else if (event.key === "Enter" && highlightedProjectId) {
        event.preventDefault();
        window.location.href = `/${highlightedProjectId}`;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardNavigableProjects, highlightedProjectId, filterShelf.searchInputRef]);

  function handleProjectRowBlur(event: FocusEvent<HTMLLIElement>, projectId: string) {
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setHighlightedProjectId((current) => (current === projectId ? null : current));
  }

  const visibleProjects = filteredActiveProjects;
  const visibleClients = new Set(visibleProjects.map((project) => getProjectClientLabel(project))).size;

  const workbench = domainAllowed ? (
    <>
      <ProjectsFilterShelf
        searchValue={filterShelf.searchValue}
        searchInputRef={filterShelf.searchInputRef}
        onSearchChange={filterShelf.setSearchValue}
        effectiveSearchActive={filterShelf.effectiveSearch.length >= 2}
        filterClientId={filterShelf.filterClientId}
        setFilterClientId={filterShelf.setFilterClientId}
        derivedClientOptions={filterShelf.derivedClientOptions}
        clientFilterDisabled={filterShelf.clientFilterDisabled}
        projectSort={filterShelf.projectSort}
        setProjectSort={filterShelf.setProjectSort}
        onKeyDown={filterShelf.handleCommandRowKeyDown}
        resultCount={visibleProjects.length}
        clientCount={visibleClients}
      />
      <div className="projectsPulseRow" aria-label="Filter search results by status">
        {statusSummaries.map((item) => (
          <OneShotButton
            key={item.key}
            className={`projectsPulseButton tone-${item.key} ${statusFilter === item.key ? "projectsPulseButtonActive" : ""}`}
            onClick={() => setStatusFilter((current) => (current === item.key ? "all" : item.key))}
            aria-pressed={statusFilter === item.key}
            aria-label={`${item.title}: ${item.count} project${item.count === 1 ? "" : "s"}`}
          >
            <span>{item.title}</span>
            <strong>{item.count}</strong>
          </OneShotButton>
        ))}
      </div>
    </>
  ) : null;

  const viewport = domainAllowed ? (
    <ProjectsListView
      items={filteredActiveProjects}
      projectColumns={projectColumns}
      activeTab="list"
      hasSearchOrFilter={Boolean(activeSearch || filterShelf.filterClientId || statusFilter !== "all")}
      highlightedProjectId={highlightedProjectId}
      emptyState={
        activeSearch || filterShelf.filterClientId || statusFilter !== "all"
          ? "No projects match this edit of the index."
          : "No active projects yet."
      }
      onOpenCreateDialog={openCreateDialog}
      onHighlightProject={setHighlightedProjectId}
      onProjectBlur={handleProjectRowBlur}
      renderProjectTitle={renderProjectTitle}
      getProjectStatusLabel={getProjectStatusLabel}
      getProjectClientLabel={getProjectClientLabel}
    />
  ) : null;

  return <ProjectsWorkspaceShell workbench={workbench} viewport={viewport} />;
}
```

Notes:
- The `KeyboardEvent`, `useRef`, and `ProjectSort` imports from the original are no longer needed.
- `setActiveSearch`, `setFilterClientId`, `setProjectSort`, `refreshProjects` come through the hook (`filterShelf.*`), not via direct destructure of `useProjectsWorkspace`.
- The `searchInputRef` reference inside the global keydown listener now reads from `filterShelf.searchInputRef`.

- [ ] **Step 6: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

If failures: most likely a missing import or a type mismatch on the hook return type. Verify each import added to the new files matches its source module.

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: 513 passed, 3 skipped (matches main baseline). The view-component tests (`projects-board-view.test.tsx`, `projects-list-view.test.tsx`) are downstream of this change and should still pass.

- [ ] **Step 8: Manual UI smoke test (golden path)**

Run: `pnpm dev` (in the worktree)

In the browser, exercise:
- **Projects board** (`/flow` route): client filter dropdown changes the project set, sort dropdown re-orders cards, search input debounces (300ms) and re-fetches, Escape clears the search input, drag-drop a card to a different column, "send to billing" action.
- **Projects list** (`/` root route): client filter dropdown, sort dropdown, search input debounce, Escape clears search, status filter chips toggle, "/" key focuses the search input from anywhere on the page, ArrowUp/ArrowDown navigates highlighted project, Enter opens the highlighted project.

If any behavior diverges from main, stop and report — do not proceed to commit.

- [ ] **Step 9: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`. The new hook + component are consumed by both container components; no dead exports.

- [ ] **Step 10: Run `fallow dupes` and verify cleanup**

Run: `pnpm exec fallow dupes 2>&1 | grep -E "projects-board\.tsx|projects-list\.tsx" || echo "no projects-board/list dupes"`
Expected: `no projects-board/list dupes`.

If a smaller residual dupe surfaces (e.g., the tiny `visibleClients` line might cluster), document it in the PR description and accept it.

- [ ] **Step 11: Commit**

```bash
git add components/projects/use-projects-filter-shelf.ts components/projects/projects-filter-shelf.tsx components/projects/projects-board.tsx components/projects/projects-list.tsx
git commit -m "$(cat <<'EOF'
refactor(projects): extract filter shelf hook + component

Both ProjectsBoard and ProjectsList container components shared the
same search debounce, refresh effect, derived client options, and
filter shelf JSX. Extract into:

- useProjectsFilterShelf(projects) — search state machine + memoized
  client filter options
- <ProjectsFilterShelf /> — presentational filter/sort/search markup

Each container now keeps only its differentiated concerns: drag/drop
flash for the board, status filter + keyboard nav for the list.

No behavior change. View-component tests continue to pass.
EOF
)"
```

- [ ] **Step 12: Push and open PR**

```bash
git push -u origin refactor/projects-views-dedupe
gh pr create --title "refactor(projects): extract filter shelf hook + component" --body "$(cat <<'EOF'
## Summary
- New \`components/projects/use-projects-filter-shelf.ts\` — search state machine, refresh effect, derived client options
- New \`components/projects/projects-filter-shelf.tsx\` — presentational filter shelf markup
- \`components/projects/projects-board.tsx\` and \`.../projects-list.tsx\` consume both
- No behavior change

## Why
PR 6 of the fallow dupes cleanup series (see \`docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md\`). Removes the 4-group / ~173-line clone family across the two container components — the largest Phase 2 dupe. Keeps each container focused on its differentiated concerns (board: drag/drop; list: status filter + keyboard nav).

## Test plan
- [x] \`pnpm test\` — 513 pass / 3 skipped (matches main baseline)
- [x] \`pnpm exec tsc --noEmit\` — clean
- [x] \`pnpm exec fallow dead-code\` — clean
- [x] \`pnpm exec fallow dupes\` — no \`projects-board.tsx\`/\`projects-list.tsx\` clone groups remain
- [x] Manual smoke: filter, sort, search debounce, Escape, drag-drop (board), status chips + "/" focus + arrow nav (list)
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Implements PR 6 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. Plan extracts a hook + a presentational component as the spec described, with the hook owning the search/derived-options logic and the component owning the JSX. The list-specific status filter, keyboard navigation, and pulse row stay in `projects-list.tsx`; the board-specific drag/drop stays in `projects-board.tsx`.
- **Placeholders:** none.
- **Type consistency:** `useProjectsFilterShelf(projects: Project[])` accepts a project array (board passes `activeProjects`, list passes `filteredActiveProjects`). The hook returns a typed object whose fields the `<ProjectsFilterShelf>` props consume directly. `setProjectSort` is widened in the hook return to `(sort: ProjectSort) => void` (drops the `Dispatch<SetStateAction<...>>` shape since callers only call it with a value).
- **Scope:** two new files, two replaced files, single PR.
