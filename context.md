# Code Context

## Files Retrieved
1. `lib/config.ts` (lines 142-147, 149-163) - `emailFrom` getter and Mailgun env accessors.
2. `tests/unit/email-config.test.ts` (lines 1-43) - unit coverage for email env behavior.
3. `.env.example` (lines 7-11) - sample email env values.
4. `README.md` (lines 50-74) - email env section and Mailgun transactional email docs.

## Key Code

### `lib/config.ts`
Current sender lookup only checks `EMAIL_FROM`:
```ts
  emailFrom: () => {
    const value = getOptionalEnv("EMAIL_FROM");
    if (!value) {
      throw new Error("Missing required env var: EMAIL_FROM");
    }
    return value;
  },
```

### `tests/unit/email-config.test.ts`
Current test setup deletes `EMAIL_FROM` and assumes no fallback sender exists:
```ts
    delete process.env.EMAIL_FROM;
    process.env.MAILGUN_API_KEY = "key-test";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    delete process.env.MAILGUN_BASE_URL;
```

Current sender-required assertion:
```ts
  it("requires EMAIL_FROM when email is enabled", async () => {
    const { config } = await import("@/lib/config");

    expect(() => config.emailFrom()).toThrow("Missing required env var: EMAIL_FROM");
  });
```

### `.env.example`
Current email env sample:
```env
EMAIL_ENABLED=true
EMAIL_FROM=notifications@yourcompany.com
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
MAILGUN_BASE_URL=https://api.mailgun.net
```

### `README.md`
Current email env section:
```md
Email env vars:
- `EMAIL_ENABLED` (optional, defaults to `true`)
- `EMAIL_FROM` (required when email is enabled)
- `MAILGUN_API_KEY` (required when email is enabled)
- `MAILGUN_DOMAIN` (required when email is enabled)
- `MAILGUN_BASE_URL` (optional, defaults to `https://api.mailgun.net`)
```

Current Mailgun guidance:
```md
## Mailgun Transactional Email
- Configure a Mailgun sending domain and API key with permission to send messages.
- Set `EMAIL_FROM` to your shared sender, for example `notifications@yourcompany.com`.
- If needed, set `MAILGUN_BASE_URL` for region-specific API hosts; otherwise the default `https://api.mailgun.net` is used.
- Thread and comment API writes still succeed if email delivery fails. Failures are logged server-side as `transactional_email_failed`.
```

## Architecture
Email sender selection is centralized in `lib/config.ts`. The env sample and README mirror that contract, and `tests/unit/email-config.test.ts` is the only unit coverage for the config behavior in the inspected surface.

## Start Here
Start with `lib/config.ts` because the fallback behavior is implemented there. Then update the config test, env example, and README to match.

## Minimal Required Edits for `MAILGUN_EMAIL` Fallback

### 1) `lib/config.ts`
Replace the `emailFrom` getter with:
```ts
  emailFrom: () => {
    const value = getOptionalEnv("EMAIL_FROM") ?? getOptionalEnv("MAILGUN_EMAIL");
    if (!value) {
      throw new Error("Missing required env var: EMAIL_FROM");
    }
    return value;
  },
```

### 2) `tests/unit/email-config.test.ts`
Add a fallback test and retitle the sender-required test to reflect either env var:
```ts
  it("falls back to MAILGUN_EMAIL when EMAIL_FROM is unset", async () => {
    process.env.MAILGUN_EMAIL = "notifications@yourcompany.com";

    const { config } = await import("@/lib/config");

    expect(config.emailFrom()).toBe("notifications@yourcompany.com");
  });

  it("requires EMAIL_FROM or MAILGUN_EMAIL when email is enabled", async () => {
    const { config } = await import("@/lib/config");

    expect(() => config.emailFrom()).toThrow("Missing required env var: EMAIL_FROM");
  });
```

### 3) `.env.example`
Add the fallback sender line next to `EMAIL_FROM`:
```env
EMAIL_ENABLED=true
EMAIL_FROM=notifications@yourcompany.com
MAILGUN_EMAIL=notifications@yourcompany.com
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
MAILGUN_BASE_URL=https://api.mailgun.net
```

### 4) `README.md` email env section
Update the env bullet and the Mailgun guidance bullet:
```md
Email env vars:
- `EMAIL_ENABLED` (optional, defaults to `true`)
- `EMAIL_FROM` (preferred sender; falls back to `MAILGUN_EMAIL` if unset)
- `MAILGUN_EMAIL` (optional fallback sender for Mailgun)
- `MAILGUN_API_KEY` (required when email is enabled)
- `MAILGUN_DOMAIN` (required when email is enabled)
- `MAILGUN_BASE_URL` (optional, defaults to `https://api.mailgun.net`)
```

```md
## Mailgun Transactional Email
- Configure a Mailgun sending domain and API key with permission to send messages.
- Set `EMAIL_FROM` to your shared sender, or set `MAILGUN_EMAIL` as the fallback sender, for example `notifications@yourcompany.com`.
- If needed, set `MAILGUN_BASE_URL` for region-specific API hosts; otherwise the default `https://api.mailgun.net` is used.
- Thread and comment API writes still succeed if email delivery fails. Failures are logged server-side as `transactional_email_failed`.
```
