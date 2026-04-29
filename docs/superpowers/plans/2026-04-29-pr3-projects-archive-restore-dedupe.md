# PR 3: `app/projects/[id]/{archive,restore}` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~32-line clone groups between `app/projects/[id]/archive/route.ts` and `app/projects/[id]/restore/route.ts` by extracting a single shared POST handler that takes `archived: boolean` as a parameter. After this PR, `fallow dupes` reports zero clone groups across these two route files.

**Architecture:** Add `lib/projects-archive-restore.ts` exporting `createProjectArchiveRestoreHandler(archived)` — a factory returning the route's `POST` function. The two routes differ in exactly two places: the `archived` boolean passed to `getProjectStorageDirForArchiveState` and the same boolean passed to `setProjectArchivedWithStorageDir`. Everything else (auth, lookup, adapter call, error mapping) is shared. The two route files become 2-line re-exports.

**Tech Stack:** Next.js App Router, TypeScript, Vitest.

**Refactor discipline:** Tests in `tests/unit/project-archive-route.test.ts` and `tests/unit/project-restore-route.test.ts` cover both paths. They import `POST` from each route file and mock `@/lib/auth`, `@/lib/repositories`, `@/lib/storage/dropbox-adapter`, and `@/lib/project-storage`. They will continue to pass because the re-exported `POST` is a function reference and the helper imports the same modules. No new tests are added.

This PR follows the same factory pattern as PR 2 (clients archive/restore), simpler because there's no `after()` block — the move is synchronous and the response is `200 ok` instead of `202 accepted`.

---

### Task 1: Extract shared archive/restore handler factory for projects

**Files:**
- Create: `lib/projects-archive-restore.ts`
- Modify: `app/projects/[id]/archive/route.ts` (replace contents)
- Modify: `app/projects/[id]/restore/route.ts` (replace contents)

**Reference — current shape:** Both route files have a 39-line POST body. The only differences are at lines 17 and 24:

| Line | Archive route | Restore route |
|---|---|---|
| 17 | `getProjectStorageDirForArchiveState(project, true)` | `getProjectStorageDirForArchiveState(project, false)` |
| 24 | `setProjectArchivedWithStorageDir(id, true, moved.projectDir)` | `setProjectArchivedWithStorageDir(id, false, moved.projectDir)` |

Everything else is byte-identical: imports, `requireUser`, `getProject`, the storage move via `DropboxStorageAdapter.moveProjectFolder`, the not-found re-check after the update, the success response (`ok({ project })`), and the outer `try/catch` mapping auth errors to `unauthorized`, team-select-user errors to `serverError(<specific message>)`, and everything else to `serverError()`.

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b refactor/projects-archive-restore-dedupe
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm test tests/unit/project-archive-route.test.ts tests/unit/project-restore-route.test.ts`
Expected: all tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 3 "projects/\[id\]/archive\|projects/\[id\]/restore" | head -20`
Expected: at least one clone group includes both route files (~32 lines total across 2 groups).

- [ ] **Step 3: Create the shared handler at `lib/projects-archive-restore.ts`**

Create the file with this exact content:

```ts
import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir, getProjectStorageDirForArchiveState } from "@/lib/project-storage";
import { getProject, setProjectArchivedWithStorageDir } from "@/lib/repositories";
import { DropboxStorageAdapter, isTeamSelectUserRequiredError } from "@/lib/storage/dropbox-adapter";

export function createProjectArchiveRestoreHandler(archived: boolean) {
  return async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await requireUser(request);
      const { id } = await params;
      const project = await getProject(id);
      if (!project) {
        return notFound("Project not found");
      }

      const currentDir = getProjectStorageDir(project);
      const nextDir = getProjectStorageDirForArchiveState(project, archived);
      const adapter = new DropboxStorageAdapter();
      const moved = await adapter.moveProjectFolder({
        fromPath: currentDir,
        toPath: nextDir
      });

      const updatedProject = await setProjectArchivedWithStorageDir(id, archived, moved.projectDir);
      if (!updatedProject) {
        return notFound("Project not found");
      }

      return ok({ project: updatedProject });
    } catch (error) {
      if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
        return unauthorized(error.message);
      }
      if (isTeamSelectUserRequiredError(error)) {
        return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
      }
      return serverError();
    }
  };
}
```

- [ ] **Step 4: Replace `app/projects/[id]/archive/route.ts`**

Overwrite the entire file with:

```ts
import { createProjectArchiveRestoreHandler } from "@/lib/projects-archive-restore";

export const POST = createProjectArchiveRestoreHandler(true);
```

- [ ] **Step 5: Replace `app/projects/[id]/restore/route.ts`**

Overwrite the entire file with:

```ts
import { createProjectArchiveRestoreHandler } from "@/lib/projects-archive-restore";

export const POST = createProjectArchiveRestoreHandler(false);
```

- [ ] **Step 6: Run project archive + restore route tests**

Run: `pnpm test tests/unit/project-archive-route.test.ts tests/unit/project-restore-route.test.ts`
Expected: all tests pass.

If failures: verify the factory's imports use `@/` aliases (matching test mocks). Verify the `archived` boolean is passed correctly to both `getProjectStorageDirForArchiveState` and `setProjectArchivedWithStorageDir`.

- [ ] **Step 7: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: 447 passed, 3 skipped (matches main baseline).

- [ ] **Step 9: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`.

- [ ] **Step 10: Run `fallow dupes` and verify the project archive/restore clone groups are gone**

Run: `pnpm exec fallow dupes 2>&1 | grep -E "projects/\[id\]/(archive|restore)/route\.ts" || echo "no project archive/restore dupes"`
Expected: `no project archive/restore dupes`.

If a smaller residual dupe surfaces (the two thin re-export files might cluster), document it in the PR description and accept it. Do not add a fallow ignore.

- [ ] **Step 11: Commit**

```bash
git add lib/projects-archive-restore.ts app/projects/[id]/archive/route.ts app/projects/[id]/restore/route.ts
git commit -m "$(cat <<'EOF'
refactor(projects): extract archive/restore route handler factory

Both POST handlers shared 37 of 39 lines; only the archived boolean
passed to getProjectStorageDirForArchiveState and
setProjectArchivedWithStorageDir differed. Replace with a single
factory in lib/projects-archive-restore.ts. Each route file becomes
a 2-line re-export.

No behavior change. Existing project-archive-route and
project-restore-route tests stay green.
EOF
)"
```

- [ ] **Step 12: Push and open PR**

```bash
git push -u origin refactor/projects-archive-restore-dedupe
gh pr create --title "refactor(projects): extract archive/restore route handler factory" --body "$(cat <<'EOF'
## Summary
- New \`lib/projects-archive-restore.ts\` exports \`createProjectArchiveRestoreHandler(archived)\`
- \`app/projects/[id]/archive/route.ts\` and \`.../restore/route.ts\` reduce to 2-line re-exports
- No behavior change

## Why
PR 3 of 9 in the fallow dupes cleanup series (see \`docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md\`). Removes the ~32-line clone groups between the two project archive/restore routes.

## Test plan
- [x] \`pnpm test tests/unit/project-archive-route.test.ts tests/unit/project-restore-route.test.ts\` — all pass
- [x] \`pnpm test\` — 447 pass / 3 skipped
- [x] \`pnpm exec tsc --noEmit\` — clean
- [x] \`pnpm exec fallow dead-code\` — clean
- [x] \`pnpm exec fallow dupes\` — no \`app/projects/[id]/(archive|restore)/route.ts\` clone groups remain
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Implements PR 3 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. Same pattern as PR 2 (factory based on a parameter), simpler because no `after()` block.
- **Placeholders:** none.
- **Type consistency:** `createProjectArchiveRestoreHandler(archived: boolean)` returns `(request: Request, { params }: { params: Promise<{ id: string }> }) => Promise<Response>`, matching both existing route files.
- **Scope:** one new file, two replaced files, single PR.
