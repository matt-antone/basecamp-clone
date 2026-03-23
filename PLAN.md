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
