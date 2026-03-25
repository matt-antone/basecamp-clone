# Transactional Email v1 via Google Workspace

## Summary
Add internal transactional email notifications for new discussion threads and new comments using Google Workspace SMTP relay. Emails will go to all other signed-in teammates in `user_profiles` except the actor, from a shared sender address such as `notifications@yourcompany.com`. Email delivery is best-effort: the main API action succeeds even if email sending fails, and failures are logged server-side.

## Key Changes
- Add a mailer module built around `nodemailer` with a narrow internal interface:
  - `sendThreadCreatedEmail(...)`
  - `sendCommentCreatedEmail(...)`
  - shared `sendMail(...)`
- Use Google Workspace SMTP relay as the first provider.
  - New env vars in config:
    - `EMAIL_FROM`
    - `SMTP_HOST` default `smtp-relay.gmail.com`
    - `SMTP_PORT` default `587`
    - `SMTP_SECURE` default `false`
    - `SMTP_USERNAME` optional
    - `SMTP_PASSWORD` optional
    - `EMAIL_ENABLED` default `true`
- Add repository support to fetch recipients from existing workspace users:
  - list all `user_profiles` with workspace-domain emails
  - exclude the acting user
  - skip send when the recipient list is empty
- Add simple HTML + text email templates for:
  - new thread in a project
  - new comment on a thread
- Wire notifications into the existing create flows after the DB write succeeds:
  - [app/projects/[id]/threads/route.ts](/Volumes/External/Glyphix%20Dropbox/Development%20Files/Under%20Development/basecamp-clone/app/projects/%5Bid%5D/threads/route.ts)
  - [app/projects/[id]/threads/[threadId]/comments/route.ts](/Volumes/External/Glyphix%20Dropbox/Development%20Files/Under%20Development/basecamp-clone/app/projects/%5Bid%5D/threads/%5BthreadId%5D/comments/route.ts)
- Include direct links back into the app using the existing route structure.
- Log structured failures with event type, actor id, project id, thread id, and recipient count, but do not return a 5xx for mail-only failures.
- Update docs and `.env.example` with Google Workspace SMTP relay setup instructions.

## Interfaces and Behavior
- No new public HTTP endpoints.
- Internal config API gains SMTP/email env accessors in [lib/config.ts](/Volumes/External/Glyphix%20Dropbox/Development%20Files/Under%20Development/basecamp-clone/lib/config.ts).
- Internal mail payload shape should include:
  - actor name/email
  - project name/id
  - thread title/id
  - comment excerpt for comment notifications
  - canonical app URL for the destination page
- Subject lines:
  - `[Project Name] New discussion: {thread title}`
  - `[Project Name] New comment on: {thread title}`

## Test Plan
- Unit test the mailer:
  - builds the correct SMTP transport config
  - skips sending when `EMAIL_ENABLED=false`
  - renders expected subject, text, and recipient list
- Route tests:
  - thread creation still returns `201` when email succeeds
  - comment creation still returns `201` when email succeeds
  - thread creation still returns `201` when email send throws, and logs failure
  - comment creation still returns `201` when email send throws, and logs failure
  - actor is excluded from recipients
  - empty recipient set results in no send attempt
- Config tests:
  - required email env handling is correct when email is enabled

## Assumptions and Defaults
- v1 is internal-only for the 5-person team.
- Recipients are all other teammates already present in `user_profiles`; there is no project membership or watcher model in v1.
- Notifications are only for newly created threads and comments, not project creation, edits, archives, restores, uploads, or auth events.
- Delivery is synchronous best-effort for now; no background queue or retries in v1.
- Google Workspace SMTP relay is the provider of record for v1, but the mailer interface should stay swappable for a future move to Postmark/Resend/SES.
