# Archive Tab — Client Filter

**Date:** 2026-04-16
**Scope:** `components/projects/archive-tab.tsx` and its parent wiring.
**Status:** Design approved; ready for implementation plan.

## Goal

Add a client filter dropdown to the Archive tab so users can narrow archived projects by client, mirroring the filter available on the Board and List tabs.

## Non-Goals

- No backend changes. `GET /projects/archived` already accepts and validates `clientId`.
- No workspace-context changes. Archive uses its own local state.
- No sort control on the Archive tab.
- No URL persistence of the filter.
- No new empty-state copy; existing messages are kept.
- No `disabled` logic on the selector (all clients are always selectable).

## Current State

- `components/projects/archive-tab.tsx` accepts `filterClientId` prop and already passes it to `/projects/archived?clientId=` when set. No UI selector exists.
- `components/projects/projects-archive.tsx` passes `filterClientId` from workspace context into `ArchiveTab`.
- `components/projects/projects-workspace-context.tsx` holds shared `filterClientId` state used by Board + List tabs.
- `components/projects/projects-board.tsx` renders the reference markup: `.projectsFilterShelf > .projectsFilterControls > .projectsFilterToolbar > label.projectsFilterField.projectsClientFilterField > select.projectsClientSelect`.
- `app/projects/archived/route.ts` validates `clientId` as UUID and forwards to `listArchivedProjectsPaginated`.
- Workspace context exposes a full `clients: ClientRecord[]` array including archived clients (`archived_at` timestamp).

## Design

### Approach

**Mirror the board's filter markup, but use archive-local state.** The Archive tab will own its own `filterClientId` state rather than sharing with the workspace context. This isolates the archive filter from the Board/List filter — switching tabs never leaks one view's selection into the other.

### Files Touched

- `components/projects/archive-tab.tsx` — add local state + selector UI; pull `clients` from workspace context.
- `components/projects/projects-archive.tsx` — stop passing `filterClientId` into `ArchiveTab`.
- No changes: API route, workspace context, global CSS (reuse board class names).

### Component Changes

**Props.** Remove `filterClientId` from `ArchiveTab`'s `Props` type and signature.

**State.** Add:

```ts
const [filterClientId, setFilterClientId] = useState<string | null>(null);
```

**Clients source.** Pull from workspace context:

```ts
const { clients } = useProjectsWorkspace();
```

**Derived options.** Full client list, sorted by name, `" (Archived)"` appended for archived clients:

```ts
const clientOptions = useMemo(
  () =>
    [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        label: c.archived_at ? `${c.name} (Archived)` : c.name,
      })),
  [clients]
);
```

**Effect.** Fetch effect deps remain `[debouncedSearch, page, accessToken, filterClientId, refreshKey]`. `filterClientId` now references the local state.

**Page reset.** On selector change, call `setPage(1)` alongside `setFilterClientId`, matching the existing debounced-search pattern.

### Markup

Wrap search and new client select in `.projectsFilterToolbar` inside the existing `.projectsFilterShelf > .projectsFilterControls`:

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
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
    <label className="projectsSearchShell">
      {/* existing search input unchanged */}
    </label>
  </div>
</div>
```

### Data Flow

1. User selects a client → `setFilterClientId(id)` + `setPage(1)`.
2. Fetch effect fires with new `filterClientId`.
3. Request built: `GET /projects/archived?search=&page=&limit=20&clientId=<uuid>` (`clientId` omitted when `null`).
4. Route validates UUID; repository filters archived projects by `client_id`.
5. Response updates `result`; list and pagination re-render.

### Cross-Tab Behavior

- Archive writes only to its local state. Workspace context's `filterClientId` is never mutated by Archive.
- Board → Archive: Archive starts `null` (ignores whatever Board had selected).
- Archive → Board: Board's previous selection is preserved, since Archive never touched it.
- Archive remount resets the filter to `null` (no persistence).

### Empty State

Unchanged. Existing copy stays:
- With search: "No archived projects match this search."
- Without search: "No archived projects are parked here yet."

A client-only filter miss currently falls under the "no archived projects are parked here yet" branch. Accepted tradeoff; no copy changes in this spec.

## Testing

**New file:** `tests/unit/archive-tab.test.tsx`

Cases:
- Renders default `"All clients"` option.
- Renders client names from workspace context.
- Appends `" (Archived)"` to archived client labels.
- Selecting a client issues a fetch with `clientId=<uuid>` in the URL.
- Selecting `"All clients"` issues a fetch without `clientId`.
- Changing the selection resets `page` to 1.

**Unchanged:** `tests/unit/projects-archived-route.test.ts` already covers backend `clientId` behavior.

**Manual QA:**
- Set Board filter to a specific client → switch to Archive → Archive filter is empty; returning to Board restores prior selection.
- Selecting a client in Archive filters the list and resets pagination.
- Archived clients show `(Archived)` suffix in the dropdown.
- Selecting a client with no archived projects lands on the existing empty state.
