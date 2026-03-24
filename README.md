# Basecamp Clone v1

Next.js + Supabase + Dropbox implementation based on `PLAN.md`.

## Features
- Google OAuth callback domain enforcement
- Projects, discussions, comments APIs
- Markdown sanitize + render utility
- Dropbox-backed file metadata + temporary links
- Canonical project identity: `CLIENTCODE-0001-Title`
- Dropbox project working directories: `/projects/<client-slug>/<project-code>-<project-slug>/uploads`
- Basecamp 2 import job endpoints with idempotent mapping tables
- Working authenticated UI with route-based navigation
- Settings page at `/settings` with tabbed client management
- Navigation:
  - `/` list/create/edit projects
  - `/:id` project view and discussion creation
  - `/:id/:discussion` discussion thread and comments

## Run
1. `cp .env.example .env.local`
2. Fill env vars.
3. `npm install`
4. Run SQL in:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_clients.sql`
   - `supabase/migrations/0003_project_status.sql`
   - `supabase/migrations/0004_user_profiles.sql`
   - `supabase/migrations/0005_project_identity_and_storage.sql`
   - `supabase/migrations/0006_project_tags_taxonomy.sql`
   - `supabase/migrations/0007_comment_attachments.sql`
   - `supabase/migrations/0006_project_tags_taxonomy.sql`
5. `npm run dev`

Required browser auth env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Dropbox env vars:
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `DROPBOX_PROJECTS_ROOT_FOLDER` (optional, defaults to `/projects`)

## API Paths
- `POST /auth/google/callback`
- `GET|POST /projects`
- `GET|POST /clients`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `POST /projects/:id/archive`
- `POST /projects/:id/restore`
- `GET|POST /projects/:id/threads`
- `GET /projects/:id/threads/:threadId`
- `POST /projects/:id/threads/:threadId/comments`
- `PATCH /projects/:id/threads/:threadId/comments/:commentId`
- `POST /projects/:id/files/upload-init`
- `POST /projects/:id/files/upload-complete`
- `GET /projects/:id/files`
- `GET /projects/:id/files/:fileId/download-link`
- `POST /admin/imports/basecamp2`
- `GET /admin/imports/:jobId`
- `POST /admin/imports/:jobId/retry-failed`

## Tests
- `npm test` runs unit + integration tests.
- `tests/e2e/user-flow.spec.ts` is an E2E flow placeholder to wire into Playwright/Cypress.

## Before First Login
- In Supabase Auth settings, enable Google provider.
- Add your local callback URL (for example `http://localhost:3000`) in Supabase redirect URLs.

## Dropbox Refresh Token Helper
- Script: `npm run dropbox:refresh-token -- --code <AUTH_CODE> --app-key <APP_KEY> --app-secret <APP_SECRET>`
- You can omit `--app-key` / `--app-secret` if `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` are already set in env.
- First get the auth code by opening:
  - `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code`
