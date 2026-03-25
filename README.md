# Basecamp Clone v1

Next.js + Supabase + Dropbox implementation based on `PLAN.md`.

## Features
- Google OAuth callback domain enforcement
- Projects, discussions, comments APIs
- Markdown sanitize + render utility
- Dropbox-backed file metadata + temporary links
- Best-effort transactional email notifications for new discussions and comments
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

Required server env vars:
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKSPACE_DOMAIN`
- `NEXT_PUBLIC_SITE_URL` (recommended for production redirects; example `https://projects.yourcompany.com`)

Email env vars:
- `EMAIL_ENABLED` (optional, defaults to `true`)
- `EMAIL_FROM` (required when email is enabled)
- `SMTP_HOST` (optional, defaults to `smtp-relay.gmail.com`)
- `SMTP_PORT` (optional, defaults to `587`)
- `SMTP_SECURE` (optional, defaults to `false`)
- `SMTP_USERNAME` (optional, but must be paired with `SMTP_PASSWORD` when used)
- `SMTP_PASSWORD` (optional, but must be paired with `SMTP_USERNAME` when used)

Dropbox env vars:
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `DROPBOX_SELECT_USER` (required for Dropbox Business team tokens with team member file access)
- `DROPBOX_SELECT_ADMIN` (optional alternative for admin-oriented team access)
- `DROPBOX_PROJECTS_ROOT_FOLDER` (optional, defaults to `/projects`)

## Google Workspace SMTP Relay
- Configure Google Workspace SMTP relay to allow your app host or SMTP-authenticated sends.
- Set `EMAIL_FROM` to your shared sender, for example `notifications@yourcompany.com`.
- Leave `SMTP_USERNAME` and `SMTP_PASSWORD` blank if your relay is IP-allowlisted; otherwise provide both.
- Thread and comment API writes still succeed if email delivery fails. Failures are logged server-side as `transactional_email_failed`.

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
- In Supabase Auth URL Configuration, set `Site URL` to your production app URL.
- Add every allowed app origin to Supabase redirect URLs, including local development (`http://localhost:3000`) and your production URL.
- Set `NEXT_PUBLIC_SITE_URL` in production so OAuth always returns to the public app domain instead of a fallback host such as `localhost`.

## Dropbox Refresh Token Helper
- Script: `npm run dropbox:refresh-token -- --code <AUTH_CODE> --app-key <APP_KEY> --app-secret <APP_SECRET>`
- You can omit `--app-key` / `--app-secret` if `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` are already set in env.
- First get the auth code by opening:
  - `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code`
