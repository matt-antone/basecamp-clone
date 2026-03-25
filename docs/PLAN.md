## Basecamp 2 Replacement v1 Plan (Dropbox + Google Workspace Auth)

### Summary
Build a greenfield `Next.js + Supabase` app replacing your Basecamp 2 usage for projects, threaded discussions, and file storage.  
Authentication is Google OAuth only, restricted to your Google Workspace domain.  
Files are stored in Dropbox (primary store), while the app database keeps metadata and access control context.

### Key Implementation Changes
- **Auth and access**
  - Use Supabase Auth with Google provider.
  - Enforce Workspace-domain allowlist at login; reject non-domain accounts before app access.
  - Global project visibility for all authenticated Workspace users (as chosen).
- **Project + discussion model**
  - Projects: create/list/archive/restore.
  - Discussions: thread + comments model per project.
  - Markdown editor: CommonMark, live preview, sanitized rendering, edited timestamps.
- **Dropbox-backed file storage**
  - Backend-managed Dropbox app integration (OAuth/service token strategy).
  - Canonical folder structure: `/BasecampClone/{project_slug_or_id}/...`.
  - Upload flow: backend issues upload session/endpoint, client uploads, backend finalizes metadata.
  - Download flow: backend permission check, then short-lived Dropbox link for retrieval.
  - DB metadata table fields include: `project_id`, `uploader_user_id`, `filename`, `mime_type`, `size_bytes`, `dropbox_file_id`, `dropbox_path`, `checksum`, `created_at`.
- **Import utility (active + archived)**
  - Import Basecamp 2 projects/posts/comments/files into new schema.
  - Upload imported file blobs into Dropbox project folders.
  - Idempotent mapping tables to support safe reruns (`basecamp_id` ↔ local IDs).
  - Job tracking with per-record logs and retry-failed mode.

### Public Interfaces / APIs
- `POST /auth/google/callback` with domain enforcement policy.
- Projects: create/list/get/archive/restore endpoints.
- Discussions: create thread, list threads, get thread, create/edit comment.
- Files:
  - `POST /projects/:id/files/upload-init`
  - `POST /projects/:id/files/upload-complete`
  - `GET /projects/:id/files`
  - `GET /projects/:id/files/:fileId/download-link`
- Import/admin:
  - `POST /admin/imports/basecamp2`
  - `GET /admin/imports/:jobId`
  - `POST /admin/imports/:jobId/retry-failed`

### Test Plan
- Unit: domain-restricted auth logic, markdown sanitize/render, Dropbox metadata mapping, import idempotency.
- Integration: OAuth login flow, project/thread/comment CRUD, file upload-complete-download, Dropbox API error/retry handling.
- E2E: user signs in, creates project, posts markdown thread, comments, uploads file, downloads file.
- Import validation: sample active/archived Basecamp datasets produce expected counts and linked records.

### Assumptions and Defaults
- Single Workspace domain boundary for v1.
- Workspace-wide visibility is intentional for all projects.
- Dropbox is source of truth for file blobs; app DB is source of truth for metadata and permissions.
- Use a storage adapter interface so Dropbox can be swapped later (e.g., B2/R2) with minimal app-layer changes.

---

## Approved Enhancement Plan (2026-03-24)

Status: Completed on 2026-03-25. The approved enhancement tranche shipped with migration rollout, automated coverage, and manual verification.

### Summary
Implement the approved enhancements across three areas: project metadata, discussion UX, and the homepage/header. Keep scope tight by adding `requestor` and `personal hours` only on the individual project page, reusing the existing markdown/comment infrastructure, and fully removing the homepage spotlight project in favor of feed-driven hero content.

### Key Changes
- **Project metadata**
  - Add nullable `requestor text` and nullable `personal_hours numeric` columns to `projects`.
  - Extend repository selects/updates and the project API so `PATCH /projects/[id]` accepts optional `requestor` and `personalHours`.
  - Add a new inline project details editor on the individual project page with:
    - `requestor` text input
    - `personal hours` numeric input
    - save/cancel actions and reload of project state after save
  - Do not add these fields to project creation; existing create flow stays unchanged.
- **Discussion improvements**
  - Promote the MDX editor into a shared component and use it for the create discussion body field as well as existing comment compose/edit.
  - Wrap rendered thread/comment markdown in scoped content classes and add styles for lists, headings, blockquotes, links, code, spacing, and images so the global `ul/li` reset no longer strips discussion formatting.
  - Load image attachment thumbnails via the existing thumbnail route and render 150x150 previews matching the project files surface; non-image attachments remain download rows.
  - Move each comment edit action into a top-right action area inside the comment header.
  - Show the edit action only when `currentUser.id === comment.author_user_id`.
  - Enforce the same rule server-side in `PATCH /projects/[id]/threads/[threadId]/comments/[commentId]`, returning `403` for non-authors.
- **Homepage/header refresh**
  - In the shared top bar, fetch project counts for signed-in users and render compact PM stat chips directly beside `Project Manager`.
  - Remove the homepage spotlight project entirely.
  - Replace the freed hero area with a styled `<ul>` of the latest 2 feed posts.
  - Update feed parsing/route logic so `/feeds/latest` returns `{ posts }` instead of a random single `{ post }`:
    - parse RSS/Atom publish dates
    - merge posts across feeds
    - sort newest-first
    - return the top 2 items
  - Keep graceful fallback copy if feeds fail.
  - Remove rounded corners and border treatment from the hero loading skeleton only.

### Public Interfaces / Type Changes
- `FeaturedFeedPost` gains `publishedAt`.
- `GET /feeds/latest` response changes from single `post` to `posts: FeaturedFeedPost[]`.
- Project client/server types gain `requestor` and `personal_hours`.
- Discussion comment types explicitly include `author_user_id` for edit gating.

### Test Plan
- Migration/repository tests for reading/updating `requestor` and `personal_hours`.
- Feed parser tests for date extraction, cross-feed newest-first sorting, and 2-post route shape.
- Route test for comment edit authorization: author succeeds, non-author gets `403`.
- Manual UI verification for:
  - project details save flow
  - markdown rendering/styling
  - 150x150 attachment previews
  - hero/header layout on desktop and mobile

### Assumptions and Defaults
- `requestor` is optional free text.
- `personal hours` is an optional non-negative project-level total, not per-user or time-entry based.
- The spotlight project is removed, not relocated.
- Discussion attachment previews use existing thumbnail infrastructure and are displayed at 150x150 via CSS.
- Only comment-author edit permissions change in this pass; thread-level edit behavior stays as-is.

---

## Completed Follow-up Tranche (2026-03-25)

### Summary
Completed the follow-up tranche for site branding, project deadlines, archived-hours display, and Dropbox folder-link behavior. This work is finished and no longer in-progress.

### Landed Changes
- Added site settings persistence plus `GET|PATCH /site-settings` for configurable site title and logo URL.
- Wired branding through the header and settings UI with fallback defaults.
- Added nullable `deadline date` support for project creation, update, and project detail rendering.
- Updated project detail responses to return `{ project, userHours }` so archived projects can show a read-only roster plus total hours.
- Changed `/projects/:id/folder-link` to return authenticated JSON `{ url }` for client-side opening.
- Added migration `0010_site_settings_and_project_deadline.sql`.
- Added route-level automated coverage for `/site-settings`, `/projects/[id]/folder-link`, and project detail deadline/user-hours behavior.

### Verification
- Migration recovery and rollout completed successfully through `0010`.
- Automated verification passed with `npm test` and `npm run build`.
- Manual verification passed for site branding, deadline workflow, archived project hours, and Dropbox folder opening.
