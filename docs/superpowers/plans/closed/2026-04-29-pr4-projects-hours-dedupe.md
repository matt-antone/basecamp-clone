# PR 4: `app/projects/[id]/{archived-hours,my-hours}` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~25-line clone groups (2 groups: 17 + 8 lines) between `app/projects/[id]/archived-hours/route.ts` and `app/projects/[id]/my-hours/route.ts` by extracting a shared PATCH handler that parameterizes the three points of difference (schema, archive precondition, userId source). After this PR, `fallow dupes` reports zero clone groups across these two route files.

**Architecture:** Add `lib/project-hours-patch.ts` exporting `createProjectHoursPatchHandler(options)` — a factory whose `options` carry (a) a `resolveUserAndHours(request, authUser)` callback that parses the request body and chooses the userId, and (b) a `requireArchived: boolean` flag for the precondition check. Each route owns its zod schema and supplies a thin `resolveUserAndHours` callback. Everything else (auth → getProject → 404 → optional archive check → setProjectUserHours → refresh + listProjectUserHours → 200 ok → outer error mapping) is shared.

**Tech Stack:** Next.js App Router, Zod, TypeScript, Vitest.

**Why a callback shape rather than passing the schema directly:** the two routes use different payload fields (archived-hours requires `userId` in the body; my-hours uses `user.id` from auth). A single zod schema can't represent both without making `userId` optional and losing the type safety. The callback isolates each route's parsing concern while letting the shared handler control the workflow.

**Refactor discipline:** Tests in `tests/unit/project-archived-hours-route.test.ts` cover the archived-hours happy path and archive-precondition rejection. There is no test for `my-hours`. Both will continue to pass — the archived-hours tests assert `setProjectUserHoursMock` is called with `{ userId: "user-2", hours: 7.5 }` (from the request body), which the new callback shape produces unchanged. No new tests are added.

---

### Task 1: Extract shared project-hours PATCH handler factory

**Files:**
- Create: `lib/project-hours-patch.ts`
- Modify: `app/projects/[id]/archived-hours/route.ts` (replace contents)
- Modify: `app/projects/[id]/my-hours/route.ts` (replace contents)

**Reference — current shape:**

`archived-hours` body (lines 11–44 of the current file):
- Parse with `patchArchivedHoursSchema = z.object({ userId, hours })`
- `requireUser` → `getProject(id, user.id)` → 404 if missing → 403 if `!project.archived`
- `setProjectUserHours({ projectId: id, userId: payload.userId, hours: payload.hours })`
- Refresh + `listProjectUserHours(id)` → `ok({ project, userHours })`
- Error catch: auth → unauthorized, ZodError → badRequest, else → serverError

`my-hours` body (lines 10–40 of the current file):
- Parse with `patchMyHoursSchema = z.object({ hours })` (no userId)
- `requireUser` → `getProject(id, user.id)` → 404 if missing (no archive check)
- `setProjectUserHours({ projectId: id, userId: user.id, hours: payload.hours })` (uses authenticated user)
- Refresh + `listProjectUserHours(id)` → `ok({ project, userHours })`
- Same error catch as archived-hours

The three differences: schema, archive check, userId source. Everything else is identical.

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b refactor/projects-hours-dedupe
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm test tests/unit/project-archived-hours-route.test.ts`
Expected: 2 tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 3 "archived-hours\|my-hours" | head -10`
Expected: at least one clone group includes both route files (~25 lines across 2 groups).

- [ ] **Step 3: Create the shared handler at `lib/project-hours-patch.ts`**

Create the file with this exact content:

```ts
import { requireUser } from "@/lib/auth";
import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProject, listProjectUserHours, setProjectUserHours } from "@/lib/repositories";
import { z } from "zod";

type ResolvedHours = {
  userId: string;
  hours: number | null;
};

type ProjectHoursPatchOptions = {
  resolveUserAndHours: (
    request: Request,
    authUser: { id: string }
  ) => Promise<ResolvedHours>;
  requireArchived: boolean;
};

export function createProjectHoursPatchHandler(options: ProjectHoursPatchOptions) {
  return async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      const user = await requireUser(request);
      const { id } = await params;
      const { userId, hours } = await options.resolveUserAndHours(request, user);
      const project = await getProject(id, user.id);
      if (!project) {
        return notFound("Project not found");
      }
      if (options.requireArchived && !project.archived) {
        return forbidden("Archived hours can only be edited on archived projects");
      }

      await setProjectUserHours({
        projectId: id,
        userId,
        hours
      });

      const [refreshedProject, userHours] = await Promise.all([
        getProject(id, user.id),
        listProjectUserHours(id)
      ]);
      return ok({ project: refreshedProject, userHours });
    } catch (error) {
      if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
        return unauthorized(error.message);
      }
      if (error instanceof z.ZodError) {
        return badRequest(error.message);
      }
      return serverError();
    }
  };
}
```

- [ ] **Step 4: Replace `app/projects/[id]/archived-hours/route.ts`**

Overwrite the entire file with:

```ts
import { z } from "zod";
import { createProjectHoursPatchHandler } from "@/lib/project-hours-patch";

const patchArchivedHoursSchema = z.object({
  userId: z.string().min(1),
  hours: z.number().nonnegative().nullable()
});

export const PATCH = createProjectHoursPatchHandler({
  requireArchived: true,
  async resolveUserAndHours(request) {
    const payload = patchArchivedHoursSchema.parse(await request.json());
    return { userId: payload.userId, hours: payload.hours };
  }
});
```

- [ ] **Step 5: Replace `app/projects/[id]/my-hours/route.ts`**

Overwrite the entire file with:

```ts
import { z } from "zod";
import { createProjectHoursPatchHandler } from "@/lib/project-hours-patch";

const patchMyHoursSchema = z.object({
  hours: z.number().nonnegative().nullable()
});

export const PATCH = createProjectHoursPatchHandler({
  requireArchived: false,
  async resolveUserAndHours(request, user) {
    const payload = patchMyHoursSchema.parse(await request.json());
    return { userId: user.id, hours: payload.hours };
  }
});
```

- [ ] **Step 6: Run archived-hours route tests**

Run: `pnpm test tests/unit/project-archived-hours-route.test.ts`
Expected: 2 tests pass.

If failures: verify the factory's imports use `@/` aliases. Verify the order of operations matches the originals (parse → getProject → exists check → archive check → setProjectUserHours → refresh).

- [ ] **Step 7: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: 447 passed, 3 skipped (matches main baseline).

- [ ] **Step 9: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`.

- [ ] **Step 10: Run `fallow dupes` and verify cleanup**

Run: `pnpm exec fallow dupes 2>&1 | grep -E "(archived-hours|my-hours)/route\.ts" || echo "no project hours dupes"`
Expected: `no project hours dupes`.

If a smaller residual dupe surfaces (the two re-export files might cluster), document in PR description and accept. Do not add a fallow ignore.

- [ ] **Step 11: Commit**

```bash
git add lib/project-hours-patch.ts app/projects/[id]/archived-hours/route.ts app/projects/[id]/my-hours/route.ts
git commit -m "$(cat <<'EOF'
refactor(projects): extract shared hours PATCH handler factory

Both PATCH handlers shared the auth → getProject → setProjectUserHours
→ refresh workflow. Differences (schema, archive precondition, userId
source) are now factory options. Each route owns its zod schema and
supplies a thin resolveUserAndHours callback.

No behavior change. Existing project-archived-hours-route tests stay
green.
EOF
)"
```

- [ ] **Step 12: Push and open PR**

```bash
git push -u origin refactor/projects-hours-dedupe
gh pr create --title "refactor(projects): extract shared hours PATCH handler factory" --body "$(cat <<'EOF'
## Summary
- New \`lib/project-hours-patch.ts\` exports \`createProjectHoursPatchHandler(options)\`
- Each route owns its zod schema and supplies a \`resolveUserAndHours\` callback
- \`requireArchived\` flag controls the archive precondition
- No behavior change

## Why
PR 4 of 9 in the fallow dupes cleanup series (see \`docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md\`). Removes the ~25-line clone groups across \`archived-hours\` and \`my-hours\` PATCH handlers.

## Test plan
- [x] \`pnpm test tests/unit/project-archived-hours-route.test.ts\` — 2 tests pass
- [x] \`pnpm test\` — 447 pass / 3 skipped
- [x] \`pnpm exec tsc --noEmit\` — clean
- [x] \`pnpm exec fallow dead-code\` — clean
- [x] \`pnpm exec fallow dupes\` — no \`(archived-hours|my-hours)/route.ts\` clone groups remain
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Implements PR 4 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. Same factory pattern as PRs 2 and 3, parameterized via a callback (`resolveUserAndHours`) plus a flag (`requireArchived`) because the routes differ in three places, not just one boolean.
- **Placeholders:** none.
- **Type consistency:** `ResolvedHours = { userId: string; hours: number | null }` matches the shape of both routes' payloads. `ProjectHoursPatchOptions.resolveUserAndHours` returns `Promise<ResolvedHours>`. The factory closes over `options.requireArchived` and the callback.
- **Scope:** one new file, two replaced files, single PR.
