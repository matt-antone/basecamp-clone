# Project Page Polling — Design Spec

**Date:** 2026-04-30
**Supersedes:** `docs/superpowers/plans/2026-04-30-project-page-polling.md`

---

## Background

The project detail page (`app/[id]/page.tsx`) loads a project workspace: project metadata, discussions, files, user hours, expense lines, clients, and viewer profile. Today that data is loaded at page entry and after local mutations, but it does not automatically notice updates made by another user or tab.

The first draft plan added polling around a project `updatedDate`. During review we clarified two important product rules:

- The page should catch all new project activity, not just direct edits to the `projects` row.
- Polling must not overwrite local draft input while the user is editing.

The repository already separates `projects.updated_at` from `projects.last_activity_at`. New discussions, files, expense lines, and other workspace activity generally call `touchProjectActivity`, which advances `last_activity_at`. The polling timestamp therefore needs to represent overall project activity freshness.

## Goal

While the project page is open, detect new project activity every 5 minutes. If the page has no dirty local drafts, refetch the existing project page data and mark newly discovered discussion, file, and expense rows with a `New` pill until the browser refreshes, navigates away, or remounts the page.

## Non-Goals

- Real-time sockets, Supabase realtime, SSE, or WebSocket infrastructure.
- Persistent unread/read tracking across sessions.
- Per-item dismiss/read behavior for `New` pills.
- Refetching while local edits are dirty.
- Conflict resolution UI for simultaneous edits.
- Showing `New` pills for project metadata, hours rows, clients, or profile changes.

## Product Behavior

### Polling

- Poll interval is exactly 5 minutes while `ProjectPageContent` is mounted and has an auth token.
- The poll calls a lightweight route that returns `{ updatedDate }`.
- `updatedDate` means the newest known project activity timestamp, computed as the greatest non-null value of `projects.updated_at` and `projects.last_activity_at`.
- If the returned timestamp is equal to or older than the page's stored timestamp, do nothing.
- If it is newer and the page has no dirty local drafts, call the existing `loadProjectData(accessToken, projectId)` flow and apply the returned state.
- After applying refreshed state, advance the stored timestamp to the polled `updatedDate`.

### Dirty Draft Guard

Polling must not overwrite local draft inputs. If a newer timestamp is detected while any guarded draft is dirty, the page should record that a refresh is pending and skip applying data for that poll cycle.

The dirty guard should include:

- Open/edited project dialog form state if it differs from the current project-derived form values.
- `myHoursInput` if it differs from `formatHoursInput(project?.my_hours)`.
- Any `archivedHoursInputs[userId]` that differs from its corresponding saved `userHours` value.
- Any `expenseLineDrafts[lineId]` label or amount that differs from the saved expense line.
- `newExpenseLine` when either label or amount is non-empty.
- `selectedFile` while a file is queued for upload.
- Create discussion editor content if it has unsaved title/body/attachments state available to the parent page.
- Active mutation flags: saving project, saving hours, saving expense, deleting expense, creating expense, uploading file, creating discussion, or restoring project.

When the page becomes clean after a skipped refresh, it may apply the pending refresh on the next poll tick. It does not need a visible “updates available” button in v1.

### New Pills

- Seed “seen” ID sets for discussions, files, and expense lines from the initial page data.
- Only poll-applied refreshes can mark rows as new.
- When a poll-applied refresh returns rows whose IDs were not in the seen sets, add those IDs to `newThreadIds`, `newFileIds`, or `newExpenseLineIds`.
- Update the seen sets after each applied refresh so a row is marked new once.
- Pills remain visible until full browser refresh, navigation away, or page remount.
- Local user actions that immediately update state, such as creating an expense line or uploading a file, should also add their returned IDs to the seen sets so they do not appear as new from the user's own action.

## API Design

Add:

`GET /projects/[id]/updated-date`

Response:

```json
{
  "updatedDate": "2026-04-30T12:34:56.789Z"
}
```

Behavior:

- Require the existing authenticated user flow used by `app/projects/[id]/route.ts`.
- Return `404` when the project does not exist.
- Return the project activity timestamp as an ISO string.
- Use existing `ok`, `notFound`, `unauthorized`, and `serverError` helpers.

Repository support:

- Add a small repository helper that queries only the project ID and activity timestamp instead of loading the full project.
- Prefer SQL-side calculation with `greatest(updated_at, coalesce(last_activity_at, updated_at)) as "updatedDate"`.

## Components Affected

### Server

- **`lib/repositories.ts`**
  - Add `getProjectUpdatedDate(id: string): Promise<{ updatedDate: string } | null>`.
  - Query only the target project and timestamp.

- **`app/projects/[id]/updated-date/route.ts`**
  - Implement `GET`.
  - Authenticate with `requireUser`.
  - Call `getProjectUpdatedDate`.
  - Return `{ updatedDate }` or `404`.

### Client

- **`app/[id]/page.tsx`**
  - Extend the project type to include `updated_at?: string | null` and `last_activity_at?: string | null` if needed for initial timestamp seeding.
  - Add refs/state for current activity timestamp, pending refresh, seen row IDs, and new row ID sets.
  - Add dirty-draft detection helpers.
  - Add a polling `useEffect` with cleanup.
  - Add helper logic to apply poll refreshes and calculate new row IDs.
  - Pass `newFileIds` to `ProjectFilesPanel`.
  - Render `New` pills next to new discussion titles and expense labels.

- **`components/projects/project-files-panel.tsx`**
  - Accept `newFileIds?: ReadonlySet<string>`.
  - Render the `New` pill next to file names whose ID is present.

- **`app/styles.css`**
  - Add a compact, reusable `.newItemPill` style that works in discussion rows, file metadata, and expense rows.

## Acceptance Criteria

- A project page polls every 5 minutes while open and authenticated.
- The timestamp route catches changes represented by either `projects.updated_at` or `projects.last_activity_at`.
- When no local drafts are dirty and the timestamp advances, the page refetches using the existing project data loader.
- Newly discovered discussion, file, and expense rows display a `New` pill.
- `New` pills persist until refresh/navigation/remount.
- Polling never overwrites dirty draft input.
- Local immediate mutations do not mark the user's own newly created/uploaded rows as `New`.
- Route tests cover authenticated success, missing project, and unauthenticated behavior.
- Client helper tests cover newer/equal/older timestamp comparisons, dirty skip behavior, and new ID detection.

