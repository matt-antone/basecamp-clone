# Clients List — Active/Archived Filter

**Date:** 2026-04-13
**Scope:** Settings page clients list only.
**Status:** Design approved; ready for implementation plan.

## Goal

Add a two-option filter to the clients list in `app/settings/page.tsx` so users can view either active clients (default) or archived clients. Counts shown per option.

## Non-Goals

- No server-side changes (no new query params, no new route, no migration).
- No URL persistence of filter state (local component state only).
- No change to the Add Client dialog or archive/restore actions.
- No refactor of `app/settings/page.tsx` beyond the minimum needed for the filter.
- No keyboard arrow-key navigation between tabs (native `Tab` + `Enter`/`Space` is sufficient for v1).

## Current State (relevant snippets)

- **Schema** — `supabase/migrations/0023_clients_archive.sql` adds `archived_at timestamptz null` to `clients`. "Archived" means `archived_at is not null`.
- **Repository** — `listClients()` in `lib/repositories.ts:144` returns all clients ordered by `name asc`. No filter parameter.
- **Route** — `GET /clients` in `app/clients/route.ts` calls `listClients()` and returns `{ clients }`. No query params.
- **UI** — `app/settings/page.tsx` (857 lines) loads all clients once via `settingsBootstrapResource` and renders them in a single table with per-row archive/restore buttons. `getClientArchiveStatus`, `isClientArchiveRunning`, and related helpers in the file already read `client.archived_at`.
- **Archive/restore routes** — `app/clients/[id]/archive/route.ts` and `app/clients/[id]/restore/route.ts` flip `archived_at` via `updateClientArchiveState`. Existing polling on `dropbox_archive_status` updates the bootstrap data in-place.

## Design

### Approach

Approach 1 — **inline client-side filter**. Smallest possible change to `app/settings/page.tsx`. No new files except a single test file. Server unchanged.

### State

Inside `SettingsPage`, alongside existing bootstrap state:

```tsx
const [clientFilter, setClientFilter] = useState<"active" | "archived">("active");

const { activeClients, archivedClients, visibleClients } = useMemo(() => {
  const all = initial?.clients ?? [];
  const active = all.filter(c => !c.archived_at);
  const archived = all.filter(c => c.archived_at);
  return {
    activeClients: active,
    archivedClients: archived,
    visibleClients: clientFilter === "active" ? active : archived
  };
}, [initial?.clients, clientFilter]);
```

- Source of truth: existing loaded `initial.clients`. No new fetch.
- Filter predicate: `!c.archived_at` vs `!!c.archived_at`. Consistent with existing usage in the same file (lines 225, 247, etc.) and with archive/restore routes.
- Default: `"active"`.

The existing clients table should iterate `visibleClients` instead of `initial.clients`. All other per-row logic (archive/restore buttons, status labels, polling) is unchanged.

### UI — Segmented Control

Two-button segmented control placed above the existing clients table, below the clients section heading, above or inline with the "Add client" button.

```tsx
<div role="tablist" aria-label="Client filter" className="inline-flex rounded-md border ...">
  <button
    type="button"
    role="tab"
    aria-selected={clientFilter === "active"}
    onClick={() => setClientFilter("active")}
    className={clientFilter === "active" ? "...selected" : "..."}
  >
    Active <span className="ml-1 text-xs opacity-70">({activeClients.length})</span>
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={clientFilter === "archived"}
    onClick={() => setClientFilter("archived")}
    className={clientFilter === "archived" ? "...selected" : "..."}
  >
    Archived <span className="ml-1 text-xs opacity-70">({archivedClients.length})</span>
  </button>
</div>
```

- Semantic `<div role="tablist">` with two `<button role="tab">` children.
- `aria-selected` reflects `clientFilter`.
- Count badges always rendered, including `(0)`.
- Concrete Tailwind classes chosen at implementation time to match existing `app/settings/page.tsx` button styling. No new design tokens.

### Behavior

- **Initial load** — Active tab selected; Active clients rendered.
- **Archive from Active tab** — Existing button triggers `POST /clients/:id/archive`. Row continues rendering inside the Active list while `dropbox_archive_status` polling shows "Archiving…". When server sets `archived_at`, the next bootstrap refresh updates `initial.clients`; `useMemo` recomputes; the row leaves the Active list, Active count drops by 1, Archived count rises by 1. No auto-switch to Archived tab.
- **Restore from Archived tab** — Mirror of archive. Row stays in Archived list while restoring, then leaves when `archived_at` is cleared.
- **In-flight status labels** — Existing helpers (`getClientArchiveStatus`, `isClientArchiveRunning`, and the status label strings at `settings/page.tsx:230–249`) are unchanged. Whatever the row currently shows continues to render in whichever tab it is currently in.
- **Add Client dialog** — Unchanged. New clients are created with `archived_at = null` and appear in Active. If the user is on the Archived tab when adding, the dialog still works; the new row appears in Active on next bootstrap refresh. No auto-switch.
- **Empty states**:
  - Active empty: `"No active clients."`
  - Archived empty: `"No archived clients."`
  - Rendered in place of the table body when `visibleClients.length === 0`.
- **Concurrency** — Two tabs open, one archives: filter recomputes automatically when polling refreshes `initial.clients`. No extra plumbing needed.

### Error Handling

None added. Filter is pure in-memory derivation and cannot fail. Archive/restore errors are surfaced by the existing per-row error handling (unchanged).

## Testing

**New file:** `tests/unit/settings-clients-filter.test.tsx` (React Testing Library, if already used for `app/settings/page.tsx` or similar components). Cases:

1. Renders both tabs with correct counts from a mixed `clients` array (some with `archived_at`, some without).
2. Default tab is Active; only non-archived rows visible.
3. Clicking the Archived tab shows only archived rows; counts unchanged; `aria-selected` flips correctly.
4. Empty-state copy renders when `visibleClients.length === 0` (both Active-empty and Archived-empty cases).
5. When the `clients` prop changes (simulating bootstrap refresh after archive/restore), counts and visible rows update.

**Fallback** — If React Testing Library is not already configured for `SettingsPage`, extract the filter/count derivation into a small pure helper (e.g. `filterClients(all, filter)` or inline the `useMemo` body into an exported pure function) and unit test the helper directly. This keeps test infrastructure changes to zero.

**Existing tests that must continue to pass:**

- `tests/unit/clients-patch-route.test.ts`
- `tests/unit/clients-id-route.test.ts`
- Any existing tests touching `app/settings/page.tsx` — verify during implementation.

**Manual QA checklist:**

- Tab toggle switches list.
- Counts match visible rows and total clients.
- Archive a client → disappears from Active, appears in Archived after polling completes.
- Restore a client → reverse.
- Empty Active state shows `"No active clients."`.
- Empty Archived state shows `"No archived clients."`.
- Add Client still works from both tabs.

## Out of Scope / Future Work

- URL persistence (`?clients=active|archived`) if bookmarkability is later desired.
- Search within filtered view.
- Extracting a `ClientsSection` component out of `app/settings/page.tsx` as a follow-up cleanup if the settings page file continues to grow.
- Arrow-key tab navigation.
- Server-side `listClients({ status })` filter if the client list ever grows large enough to warrant not loading everything at once.

## Open Questions

None at spec time.
