# Project Members + Discussion Edit + Discussion Attachments — Design

Date: 2026-04-30

## Goal

Add three related features to the project/discussion area:

1. **Project membership.** A flat list of users who belong to each project. Used to scope email notifications to project members instead of broadcasting to all active users.
2. **Edit discussion (thread).** Author can edit a thread's title and body after posting. Mirrors the existing comment edit pattern.
3. **Attachments on the create-discussion form.** Reuse the comment composer's attachment pipeline so users can attach files when starting a thread.

Realtime updates (live discussion / file refresh) are explicitly **deferred** to a separate spec.

## Non-Goals

- Realtime updates to project, discussion, comment, or file lists.
- Member roles or permissions (flat list, no owner/admin/viewer distinctions).
- Email notifications on edits (UI indicator only).
- Standalone attachment notifications (attachments are mentioned within thread/comment emails).
- Migration UI for legacy users (`is_legacy = true` users remain excluded from active-user pickers; no in-app reconciliation flow).
- Refactor of the entire DiscussionComposer beyond extracting the attachment pipeline needed for the create-discussion dialog.

## Architecture

### Data model

New table `project_members`:

```sql
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id text not null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_members_user_id on project_members(user_id);
```

New column on `threads` (mirror of comments' edit indicator):

```sql
alter table threads add column if not exists edited_at timestamptz;
```

Backfill, scoped to **active projects only** (`projects.archived = false` and parent client not archived):

```sql
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

The exact `comments` join column will be verified against schema during PR1 implementation; backfill logic is otherwise schema-stable.

### Repository layer (`lib/repositories.ts`)

New helpers:

- `addProjectMember(projectId, userId)` — idempotent insert.
- `removeProjectMember(projectId, userId)` — delete row; throws if it would leave the project with zero members.
- `listProjectMembers(projectId)` — returns `{ user_id, email, first_name, last_name, added_at }[]` joined to `user_profiles`.
- `listProjectMemberRecipients(projectId, excludeUserId)` — returns mailable recipients for transactional email; excludes the actor.

Existing `listNotificationRecipients()` stays in place for any non-project-scoped callers; thread/comment routes stop using it.

### API surface

New routes:

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/projects/[id]/members` | required | Returns members with display info. |
| `POST` | `/projects/[id]/members` | required | Body `{ userId }`. Anyone authenticated may add. Idempotent. |
| `DELETE` | `/projects/[id]/members/[userId]` | required | Anyone authenticated may remove. Returns 400 if it would leave the project with zero members. |
| `GET` | `/users/active` | required | Lists active users (`user_profiles.is_legacy = false`). Used by the member picker. |
| `PATCH` | `/projects/[id]/threads/[threadId]` | required, author-only | Body `{ title?, bodyMarkdown? }`. Sets `edited_at = now()`. Returns updated thread. |

Modified routes:

| Method | Path | Change |
|---|---|---|
| `POST` | `/projects` | Same transaction also inserts `(new project id, created_by)` into `project_members`. |
| `POST` | `/projects/[id]/threads` | Accepts optional `attachmentIds: string[]` in the payload (already-uploaded attachments via the composer flow). Links them to the new thread. Recipient query becomes `listProjectMemberRecipients(projectId, user.id)`. |
| `POST` | `/projects/[id]/threads/[threadId]/comments` | Recipient query becomes `listProjectMemberRecipients(projectId, user.id)`. No payload changes. |

### Access gating

Project membership controls **email recipients only**. Non-members can still view and post on any project. This matches the user's request and avoids a wider permissions migration.

### Notifications

- **Thread created:** notify project members minus actor. Email body lists attachment filenames when present.
- **Comment created:** notify project members minus actor. Email body lists attachment filenames when present.
- **Edits (thread or comment):** UI indicator only (`edited_at` rendered as "edited <time>"); no email.
- **Member added/removed:** no email.

### UI

**Project edit dialog** (`ProjectDialogForm`, opened from `app/[id]/page.tsx`):

A new "Members" section beneath existing fields:

- Current members listed with avatar/name and a remove (`×`) button.
- "Add member" combobox sourced from `/users/active`, filtered to exclude current members.
- Removing the last member is blocked client-side with an inline message; server enforces the same rule (defense in depth).
- Add/remove are optimistic; on API error, the change is reverted and a toast is shown.

**Create-discussion dialog** (`components/discussions/create-discussion-dialog.tsx`):

The dialog gains an attachments area that reuses the comment composer's upload pipeline (Dropbox temp upload link, hashing, progress, error states). Submit is disabled until all queued attachments have a terminal status (`done` or none queued). On submit, the dialog posts `{ title, bodyMarkdown, attachmentIds: [...] }`.

The shared attachment pipeline is extracted from `DiscussionComposer` into a reusable hook (e.g. `useAttachmentUploads`). Both the create-discussion dialog and the existing comment composer consume it. Visual styling follows the existing composer.

**Discussion page** (`app/[id]/[discussion]/page.tsx`):

When `thread.author_user_id === currentUser.id`, an "Edit" button appears next to the thread title/body. Clicking it swaps the title and body into edit fields (reusing the markdown editor). Save calls `PATCH /projects/[id]/threads/[threadId]`; cancel reverts. When `edited_at` is set, an "edited <time>" indicator renders next to the thread metadata, mirroring the existing comment-edit indicator.

No changes to the project list, client pages, settings page, or any non-discussion surfaces.

## Delivery — PR series

The work ships as four independent PRs against `main`. Each PR is shippable on its own; PR2 depends on PR1's migration but no other ordering is required.

### PR1 — schema and repository

1. Migration `0026_project_members.sql`:
   - Create `project_members` table and index.
   - Add `threads.edited_at` column.
   - Run the active-project backfill.
2. Add repository helpers (`addProjectMember`, `removeProjectMember`, `listProjectMembers`, `listProjectMemberRecipients`).
3. Update `POST /projects` to insert the creator into `project_members` in the same transaction.
4. Tests: migration backfill (active vs archived fixtures), repo unit tests for each helper, last-member-removal guard.

### PR2 — members UI and notification swap

1. New API routes: `/projects/[id]/members` (GET/POST/DELETE), `/users/active` (GET).
2. Add the Members section to `ProjectDialogForm`.
3. Swap thread and comment notification call-sites to `listProjectMemberRecipients(projectId, user.id)`.
4. Tests: route handler tests (auth, validation, last-member rule), Members-section RTL test, mailer recipient test confirming actor exclusion and project scoping.

PR description must call out the notification behavior change explicitly, since users currently receive emails for all projects and will only receive them for projects they're members of after this PR.

### PR3 — edit thread

1. New route `app/projects/[id]/threads/[threadId]/route.ts` with PATCH handler. Author-only check, payload validation, update `edited_at`, return updated thread.
2. Update discussion page with the edit button, inline edit mode, and edited-indicator rendering.
3. Tests: PATCH route (author-only auth, validation, edit semantics), discussion page test for edit flow.

### PR4 — attachments on new thread

1. Extract attachment-upload logic from `DiscussionComposer` into a shared hook (`useAttachmentUploads`). Comment composer is updated to use the hook.
2. Embed the attachments UI in `CreateDiscussionDialog`. Submit gated on attachment status.
3. Update `POST /projects/[id]/threads` to accept and link `attachmentIds`. The link step reuses the same finalize logic comments use.
4. Update the thread-created email template to render attachment filenames.
5. Tests: dialog test (attach, queue, submit), repo test for linking attachments to a new thread, email snapshot with attachment list.

## Testing strategy

- **Migration:** in-memory pg test seeded with a mix of active and archived projects, threads, and comments. Asserts that backfill yields exactly creator + thread starters + commenters from active projects, and zero members for archived projects/clients.
- **Repository:** unit tests for each helper, including idempotent add, last-member removal guard, and active-only recipient filtering.
- **API routes:** auth required; non-existent ids return 404; remove-last-member returns 400; PATCH thread returns 403 for non-authors.
- **Active users route:** excludes `is_legacy = true` users.
- **Notifications:** mock `sendMail`, assert recipient set equals project members minus actor; archived-client mutation guard continues to apply.
- **UI:** Members section render and add/remove flows; CreateDiscussionDialog attachment queue and submit; discussion page edit mode and indicator.
- **E2E:** extend `tests/e2e/user-flow.test.ts` with a create-discussion-with-attachment flow.

## Risks

- **Backfill correctness on production data.** Mitigation: run the backfill query as a read-only `select count(*)` first against a prod snapshot; verify totals before applying. Migration is idempotent (`on conflict do nothing`) and safe to re-run.
- **Notification volume changes (PR2).** Today users likely receive email for every active project; after PR2 they only receive email for projects they're members of. Mitigation: PR2 description spells out the change; team is told to add themselves to projects they want to follow.
- **Last-member edge case.** A project with zero members would never notify anyone. Server enforces the "cannot remove last member" rule; UI prevents the action and shows an inline message.
- **Composer refactor scope creep (PR4).** Extracting the attachment pipeline could grow into a broader composer rewrite. Mitigation: PR4 only extracts what the create-discussion dialog needs; broader cleanup is explicitly out of scope.
- **`comments` join column.** The exact comments-to-project join (`comments.thread_id` vs a denormalized `project_id`) is verified during PR1 implementation; the backfill logic is otherwise schema-stable.

## Open questions

None remaining for this spec. Realtime updates are tracked separately as a deferred follow-up.
