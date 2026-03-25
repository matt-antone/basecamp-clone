# Mailgun Migration for Transactional Email

## Summary
Replace the current Google Workspace SMTP-based transactional email path with Mailgun's HTTP API while keeping the app's notification behavior unchanged. Thread and comment creation must still succeed even if email delivery fails, and Google OAuth sign-in stays out of scope for this change.

## Implementation Changes
- Keep the existing internal mailer interface in `lib/mailer.ts`:
  - Preserve `sendMail`, `sendThreadCreatedEmail`, `sendCommentCreatedEmail`, `createCommentExcerpt`, and the current `SendMailResult` shape.
  - Replace `nodemailer`/SMTP transport creation with a direct Mailgun API call using native `fetch`.
  - Send via `POST /v3/{domain}/messages` with Basic auth `api:{MAILGUN_API_KEY}` and form fields for `from`, `to`, `subject`, `text`, and `html`.
  - If `replyTo` is provided, map it to Mailgun's `h:Reply-To` field.
  - Map Mailgun's response `id` to the existing `messageId` return field.
- Update config in `lib/config.ts`:
  - Keep `EMAIL_ENABLED` and `EMAIL_FROM`.
  - Remove `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, and `SMTP_PASSWORD`.
  - Add `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` as required when email is enabled.
  - Add optional `MAILGUN_BASE_URL`, defaulting to `https://api.mailgun.net`, so EU accounts can use `https://api.eu.mailgun.net` without code changes.
  - Ensure config accessors are only evaluated when email sending is actually attempted, so `EMAIL_ENABLED=false` still disables all provider requirements.
- Update docs and examples:
  - Replace Google Workspace SMTP relay guidance in `.env.example`, `README.md`, and this plan with Mailgun setup.
  - Document the new env contract: `EMAIL_ENABLED`, `EMAIL_FROM`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and optional `MAILGUN_BASE_URL`.
  - Remove Google-specific transactional email wording, but do not change Google OAuth login docs beyond clarifying that auth is separate from transactional email.
- Clean up dependencies:
  - Remove `nodemailer` and `@types/nodemailer` from `package.json` and the lockfile if the implementation uses native `fetch` only.

## Public and Interface Changes
- No route, database, or payload changes.
- Internal email provider configuration changes from SMTP env vars to Mailgun env vars.
- Existing thread/comment notification entrypoints and best-effort logging behavior remain unchanged.

## Test Plan
- Update mailer unit tests to mock `fetch` instead of `nodemailer`.
- Verify success case:
  - Builds the correct Mailgun request URL, auth header, and form fields.
  - Returns `{ skipped: false, recipientCount, messageId }` using Mailgun's response `id`.
- Verify skip cases:
  - `EMAIL_ENABLED=false` returns `{ skipped: true, reason: "disabled" }`.
  - Empty recipients returns `{ skipped: true, reason: "no_recipients" }`.
- Verify config tests:
  - `EMAIL_FROM`, `MAILGUN_API_KEY`, and `MAILGUN_DOMAIN` are required when email is enabled.
  - `MAILGUN_BASE_URL` defaults correctly.
  - Disabled email does not require Mailgun env vars.
- Re-run existing thread and comment route tests to confirm:
  - Successful send still returns `201`.
  - Mail failure still returns `201` and logs `transactional_email_failed`.
  - No-recipient case still avoids sending.

## Assumptions and Defaults
- Mailgun HTTP API is the chosen provider path; Mailgun SMTP is not used.
- Default Mailgun region is US via `https://api.mailgun.net`; EU support is handled through `MAILGUN_BASE_URL`.
- Google OAuth sign-in remains in place and is explicitly out of scope for this migration.
- No queueing, retry system, or webhook processing is added in this pass; this is a provider swap only.
