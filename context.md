# Code Context

## Files Retrieved
1. `app/projects/[id]/threads/[threadId]/comments/route.ts` (lines 33-143) - Comment creation path, recipient lookup, notification send, and the silent-failure catch block.
2. `app/projects/[id]/threads/route.ts` (lines 52-152) - Same notification pattern for thread creation; confirms the shared best-effort behavior.
3. `lib/mailer.ts` (lines 51-128, 157-184) - Mailgun request construction, `EMAIL_ENABLED` gate, recipient gate, and provider failure handling.
4. `lib/config.ts` (lines 141-163) - Email-related env contract and defaults.
5. `lib/repositories.ts` (lines 117-143) - Notification recipient query and workspace-domain filter.
6. `README.md` (lines 50-75) and `.env.example` (lines 1-12) - Documented production env vars and email setup.
7. `tests/unit/thread-comment-route.test.ts` (lines 96-178), `tests/unit/thread-route.test.ts` (lines 85-163), `tests/unit/email-config.test.ts` (lines 24-53), `tests/unit/mailer.test.ts` (lines 1-80) - Prove failure logging, no-recipient skip, env validation, and Mailgun request behavior.

## Key Code

### Comment creation: email is best-effort and never blocks the write
```ts
const comment = await createComment({ ... });

let recipientCount = 0;
try {
  const [actorProfile, recipients] = await Promise.all([
    getUserProfileById(user.id),
    listNotificationRecipients(user.id)
  ]);
  recipientCount = recipients.length;

  if (recipients.length === 0) {
    console.warn("transactional_email_skipped", { reason: "no_recipients" });
  } else {
    const mailResult = await sendCommentCreatedEmail(...);
    console.info("transactional_email_result", { mailResult });
  }
} catch (error) {
  console.error("transactional_email_failed", {
    eventType: "comment_created",
    recipientCount,
    error: error instanceof Error ? error.message : String(error)
  });
}

return ok({ comment }, 201);
```

### Mailer: the only feature flag is `EMAIL_ENABLED`
```ts
if (!config.emailEnabled()) {
  return { skipped: true, reason: "disabled" };
}

if (args.recipients.length === 0) {
  return { skipped: true, reason: "no_recipients" };
}

form.set("from", config.emailFrom());
const response = await fetch(buildMailgunMessagesUrl(), { ... });
if (!response.ok) {
  throw new Error(`Mailgun API request failed (${response.status}): ${body || response.statusText}`);
}
```

### Required env vars when email is actually attempted
```ts
emailEnabled: () => getBooleanEnv("EMAIL_ENABLED", true),
emailFrom: () => getOptionalEnv("EMAIL_FROM") ?? getOptionalEnv("MAILGUN_EMAIL"),
mailgunApiKey: () => getOptionalEnv("MAILGUN_API_KEY"),
mailgunDomain: () => getOptionalEnv("MAILGUN_DOMAIN"),
mailgunBaseUrl: () => getOptionalEnv("MAILGUN_BASE_URL") ?? "https://api.mailgun.net"
```

### Recipient gating can short-circuit sends before Mailgun is called
```ts
from user_profiles
where active = true
  and lower(split_part(email, '@', 2)) = $1
```

This means notifications only go to active users whose email domain matches `WORKSPACE_DOMAIN`.

## Architecture
Request flow for comment notifications:
1. `POST /projects/[id]/threads/[threadId]/comments` authenticates, validates, and creates the comment first.
2. It then loads the actor profile and notification recipients.
3. If recipients exist, it calls `sendCommentCreatedEmail()`.
4. `sendCommentCreatedEmail()` delegates to `sendMail()`, which posts to Mailgun.
5. Any email exception is caught in the route and only logged; the HTTP response still returns `201`.

So in production, a comment can save successfully even if no notification email was sent.

## Concrete Checks to Run in Production

### Env / deployment checks
- Verify `EMAIL_ENABLED` is not set to `false` in production.
- Verify one sender env exists: `EMAIL_FROM` or legacy `MAILGUN_EMAIL`.
- Verify `MAILGUN_API_KEY` is present and not blank.
- Verify `MAILGUN_DOMAIN` is present and matches the verified Mailgun sending domain.
- Verify `MAILGUN_BASE_URL` if using an EU Mailgun account; default is US `https://api.mailgun.net`.
- Verify `WORKSPACE_DOMAIN` matches the teammate email domain you expect to receive notifications.

### Log checks
- Search for `transactional_email_attempt` around the comment save timestamp.
- Search for `transactional_email_result` and inspect `mailResult`:
  - `{ skipped: true, reason: "disabled" }` → `EMAIL_ENABLED=false`
  - `{ skipped: true, reason: "no_recipients" }` → recipient query returned empty
  - `{ skipped: false, recipientCount: N }` → Mailgun was called successfully
- Search for `transactional_email_failed` and read the error message:
  - `Missing required env var: EMAIL_FROM or MAILGUN_EMAIL`
  - `Missing required env var: MAILGUN_API_KEY`
  - `Missing required env var: MAILGUN_DOMAIN`
  - `Mailgun API request failed (...)` → provider/auth/region/domain problem

### Data checks
- Confirm there are active `user_profiles` rows with emails ending in `WORKSPACE_DOMAIN`.
- Confirm the intended recipients are not marked inactive.
- Confirm the sender address is allowed by Mailgun for the configured domain.

## Likely Root Causes
- `EMAIL_ENABLED=false` disables sending entirely.
- `EMAIL_FROM` and `MAILGUN_EMAIL` are both unset, so `sendMail()` throws before calling Mailgun.
- `MAILGUN_API_KEY` or `MAILGUN_DOMAIN` is missing/blank, so the provider call never succeeds.
- `MAILGUN_BASE_URL` points to the wrong region or a bad host.
- `WORKSPACE_DOMAIN` is wrong, so the recipient query returns zero rows and the send is skipped.
- There are no active recipients in the workspace domain, so notifications are skipped before any email call.
- Mailgun rejects the request or key/domain combination; the route swallows the exception and only logs `transactional_email_failed`.

## Start Here
Start with `app/projects/[id]/threads/[threadId]/comments/route.ts` because it shows the full comment-save path, the recipient gate, and the silent-failure behavior that can make production look like notifications never send.