# PR 5: `profile/route.ts` ↔ `site-settings/route.ts` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~46-line clone group between `app/profile/route.ts` and `app/site-settings/route.ts` by extracting a shared error-handling wrapper. Each route still owns its `requireUser` call, zod parse, and business logic — only the standard `try/catch` boilerplate (auth-shaped → 401, ZodError → 400, else → 500) becomes a wrapper. After this PR, `fallow dupes` reports zero clone groups across these two route files.

**Architecture:** Add `lib/route-handlers.ts` exporting `withRouteErrors(handler, options?)`. The wrapper takes any `(request) => Promise<Response>` handler (or `(...args) => Promise<Response>` to support route handlers with params) and returns a handler that catches errors and maps them: auth-token-workspace regex → `unauthorized`, `ZodError` → `badRequest`, else → `serverError`. An optional `options.mapError(error)` runs first and can return a custom `Response | null` for route-specific cases (used by site-settings PATCH for the `"site_settings table is not available"` case).

**Why a generic `withRouteErrors` rather than the spec's `withPatchValidation(schema, handler)`:** the original spec idea bundled auth + parse + error mapping into one wrapper. After reading both files, the auth and parse calls are clean one-liners that read better inline; the boilerplate that genuinely repeats is only the catch block. Extracting just that part keeps each route's "what does this endpoint do" easy to scan, sets up Phase 3's heavier `withAuthedJson` to be a layer on top, and applies cleanly to GET handlers (no body to parse) without a special case.

**Tech Stack:** Next.js App Router, Zod, TypeScript, Vitest.

**Refactor discipline:** Tests in `tests/unit/site-settings-route.test.ts` cover GET (200 + 401) and PATCH paths. Profile route has no tests. The wrapper preserves status codes and error message bodies exactly, so existing tests stay green. No new tests are added.

**Phase 3 alignment:** This wrapper is the foundation Phase 3's `withAuthedJson(schema, handler)` builds on. PR 7 will likely define `withAuthedJson` as a thin layer over `withRouteErrors` that adds the `requireUser` and `schema.parse` steps. Keeping the layers separate now means each is independently testable and the heavier wrapper can be introduced without disrupting the simpler routes already using `withRouteErrors`.

---

### Task 1: Extract `withRouteErrors` wrapper and apply to both routes

**Files:**
- Create: `lib/route-handlers.ts`
- Modify: `app/profile/route.ts`
- Modify: `app/site-settings/route.ts`

**Reference — current shape:** Both files have the same structure: a GET (auth → fetch → ok) and a PATCH (auth → parse → mutate → ok), each wrapped in the same try/catch. The catches share auth-regex → 401 and the PATCH catches share ZodError → 400. Site-settings PATCH adds one extra case: a regex check on `error.message` for the `site_settings table is not available` migration error, returning the message body in a 500.

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b refactor/profile-site-settings-dedupe
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm test tests/unit/site-settings-route.test.ts`
Expected: tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 3 "profile/route\|site-settings"`
Expected: a clone group across `app/profile/route.ts:32-60` and `app/site-settings/route.ts:26-71`.

- [ ] **Step 3: Create the wrapper at `lib/route-handlers.ts`**

Create the file with this exact content:

```ts
import { badRequest, serverError, unauthorized } from "@/lib/http";
import { ZodError } from "zod";

type RouteHandler<Args extends readonly unknown[]> = (...args: Args) => Promise<Response>;

type WithRouteErrorsOptions = {
  /**
   * Optional first-pass error mapper. Runs before the default mapping.
   * Return a Response to short-circuit; return null to fall through to defaults.
   */
  mapError?: (error: unknown) => Response | null;
};

/**
 * Wraps a route handler with the standard error mapping used across the app:
 * - Errors whose message matches /auth|token|workspace/i → 401
 * - ZodError → 400
 * - Anything else → 500
 *
 * Pass `options.mapError` to add a route-specific case before the defaults.
 */
export function withRouteErrors<Args extends readonly unknown[]>(
  handler: RouteHandler<Args>,
  options?: WithRouteErrorsOptions
): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const custom = options?.mapError?.(error);
      if (custom) {
        return custom;
      }
      if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
        return unauthorized(error.message);
      }
      if (error instanceof ZodError) {
        return badRequest(error.message);
      }
      return serverError();
    }
  };
}
```

- [ ] **Step 4: Refactor `app/profile/route.ts`**

Overwrite the entire file with:

```ts
import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getUserProfileById, updateUserProfile } from "@/lib/repositories";
import { withRouteErrors } from "@/lib/route-handlers";
import { z } from "zod";

const updateProfileSchema = z.object({
  firstName: z.string().trim().max(120).nullable(),
  lastName: z.string().trim().max(120).nullable(),
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .refine((value) => !value || /^https?:\/\/\S+$/i.test(value), "avatarUrl must be a valid URL"),
  jobTitle: z.string().trim().max(160).nullable(),
  timezone: z.string().trim().max(120).nullable(),
  bio: z.string().trim().max(2000).nullable()
});

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const GET = withRouteErrors(async (request: Request) => {
  const user = await requireUser(request);
  const profile = await getUserProfileById(user.id);
  return ok({ profile });
});

export const PATCH = withRouteErrors(async (request: Request) => {
  const user = await requireUser(request);
  const payload = updateProfileSchema.parse(await request.json());
  const profile = await updateUserProfile({
    id: user.id,
    firstName: normalizeNullableString(payload.firstName),
    lastName: normalizeNullableString(payload.lastName),
    avatarUrl: normalizeNullableString(payload.avatarUrl),
    jobTitle: normalizeNullableString(payload.jobTitle),
    timezone: normalizeNullableString(payload.timezone),
    bio: normalizeNullableString(payload.bio)
  });

  if (!profile) {
    return badRequest("Profile not found");
  }

  return ok({ profile });
});
```

Note: the `unauthorized`, `serverError`, and `z.ZodError` imports are no longer needed — the wrapper handles those.

- [ ] **Step 5: Refactor `app/site-settings/route.ts`**

Overwrite the entire file with:

```ts
import { requireUser } from "@/lib/auth";
import { ok, serverError } from "@/lib/http";
import { DEFAULT_HOURLY_RATE_USD } from "@/lib/project-financials";
import { getSiteSettings, upsertSiteSettings } from "@/lib/repositories";
import { withRouteErrors } from "@/lib/route-handlers";
import { z } from "zod";

const patchSiteSettingsSchema = z.object({
  siteTitle: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  defaultHourlyRateUsd: z.number().min(0).max(999999.99).optional().nullable()
});

function normalizeHourlyRateForResponse(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_HOURLY_RATE_USD;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HOURLY_RATE_USD;
}

function mapSiteSettingsError(error: unknown): Response | null {
  if (error instanceof Error && /site_settings table is not available/i.test(error.message)) {
    return serverError(error.message);
  }
  return null;
}

export const GET = withRouteErrors(async (request: Request) => {
  await requireUser(request);
  const siteSettings = await getSiteSettings();
  return ok({
    siteSettings: {
      siteTitle: siteSettings?.siteTitle ?? null,
      logoUrl: siteSettings?.logoUrl ?? null,
      defaultHourlyRateUsd: normalizeHourlyRateForResponse(siteSettings?.defaultHourlyRateUsd)
    }
  });
});

export const PATCH = withRouteErrors(async (request: Request) => {
  await requireUser(request);
  const payload = patchSiteSettingsSchema.parse(await request.json());
  const currentSettings = await getSiteSettings();
  const siteSettings = await upsertSiteSettings({
    siteTitle:
      payload.siteTitle === undefined
        ? currentSettings?.siteTitle ?? null
        : typeof payload.siteTitle === "string"
          ? payload.siteTitle.trim() || null
          : null,
    logoUrl:
      payload.logoUrl === undefined
        ? currentSettings?.logoUrl ?? null
        : typeof payload.logoUrl === "string"
          ? payload.logoUrl.trim() || null
          : null,
    defaultHourlyRateUsd:
      payload.defaultHourlyRateUsd === undefined
        ? currentSettings?.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD
        : payload.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD
  });
  return ok({
    siteSettings: {
      siteTitle: siteSettings.siteTitle,
      logoUrl: siteSettings.logoUrl,
      defaultHourlyRateUsd: normalizeHourlyRateForResponse(siteSettings.defaultHourlyRateUsd)
    }
  });
}, { mapError: mapSiteSettingsError });
```

Note: `unauthorized` and `badRequest` imports are no longer needed. `serverError` is still used by `mapSiteSettingsError`.

- [ ] **Step 6: Run site-settings tests**

Run: `pnpm test tests/unit/site-settings-route.test.ts`
Expected: tests pass. The wrapper preserves status codes and message bodies — no test changes needed.

If failures: verify the wrapper imports use `@/` aliases. Verify the `mapError` callback returns the same `serverError(error.message)` shape as the original inline check.

- [ ] **Step 7: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: 448 passed, 3 skipped (matches main baseline).

- [ ] **Step 9: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`. The new `withRouteErrors` is consumed by both route files; no dead exports.

- [ ] **Step 10: Run `fallow dupes` and verify cleanup**

Run: `pnpm exec fallow dupes 2>&1 | grep -E "(profile|site-settings)/route\.ts" || echo "no profile/site-settings dupes"`
Expected: `no profile/site-settings dupes`.

If a smaller residual dupe surfaces (e.g., the two `await requireUser(request)` lines clustering with other routes), document it in the PR description. Do not add a fallow ignore.

- [ ] **Step 11: Commit**

```bash
git add lib/route-handlers.ts app/profile/route.ts app/site-settings/route.ts
git commit -m "$(cat <<'EOF'
refactor(routes): extract withRouteErrors wrapper

Both profile and site-settings routes wrapped each handler in the
same try/catch boilerplate (auth regex → 401, ZodError → 400, else
→ 500). Move that to lib/route-handlers.ts.

Site-settings PATCH passes a mapError option for the
"site_settings table is not available" migration case. Each route
still owns requireUser, zod parse, and business logic.

No behavior change. Existing site-settings tests stay green. Sets up
Phase 3's withAuthedJson as a layer on top.
EOF
)"
```

- [ ] **Step 12: Push and open PR**

```bash
git push -u origin refactor/profile-site-settings-dedupe
gh pr create --title "refactor(routes): extract withRouteErrors wrapper" --body "$(cat <<'EOF'
## Summary
- New \`lib/route-handlers.ts\` exports \`withRouteErrors(handler, options?)\` — wraps any route handler with the standard auth/zod/serverError mapping
- \`app/profile/route.ts\` and \`app/site-settings/route.ts\` use the wrapper for both GET and PATCH
- Site-settings PATCH passes \`mapError\` for the migration-error case
- No behavior change

## Why
PR 5 of 9 in the fallow dupes cleanup series (see \`docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md\`). Removes the ~46-line clone group across \`profile/route.ts\` and \`site-settings/route.ts\`. First Phase 2 PR — sets up \`withAuthedJson\` (Phase 3) as a layer over \`withRouteErrors\`.

## Test plan
- [x] \`pnpm test tests/unit/site-settings-route.test.ts\` — pass
- [x] \`pnpm test\` — 448 pass / 3 skipped
- [x] \`pnpm exec tsc --noEmit\` — clean
- [x] \`pnpm exec fallow dead-code\` — clean
- [x] \`pnpm exec fallow dupes\` — no \`(profile|site-settings)/route.ts\` clone groups remain
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Implements PR 5 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. Spec called for `withPatchValidation(schema, handler)` — this plan adjusts to `withRouteErrors(handler, options?)` after reading the landed code. The auth and parse calls read cleaner inline; only the catch boilerplate genuinely duplicates. The header notes this adjustment.
- **Placeholders:** none.
- **Type consistency:** `RouteHandler<Args extends readonly unknown[]>` accepts any number/type of args, so the wrapper works for handlers with or without route params. Both routes use `(request: Request) => Promise<Response>`. `WithRouteErrorsOptions.mapError` returns `Response | null`.
- **Scope:** one new file, two replaced files, single PR.
