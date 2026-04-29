# PR 2: `app/clients/[id]/{archive,restore}` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~46-line clone group between `app/clients/[id]/archive/route.ts` and `app/clients/[id]/restore/route.ts` by extracting a single shared POST handler that takes `mode: "archive" | "restore"` as a parameter. After this PR, `fallow dupes` reports zero clone groups across these two route files.

**Architecture:** Add `lib/clients-archive-restore.ts` exporting `createClientArchiveRestoreHandler(mode)` — a factory that returns the route's `POST` function. The handler differs only in three places: (a) the `archived_at` precondition (must be null for archive, must be set for restore), (b) which `DropboxStorageAdapter` method runs the move (`archiveClientRootFolder` vs `restoreClientRootFolder`), and (c) the final `updateClientArchiveState` payload (`status: "completed", archivedAt: ISO` vs `status: "idle", archivedAt: null`). The factory branches on `mode` for those three points and shares everything else. The two route files become 2-line re-exports.

**Tech Stack:** Next.js App Router, `next/server` `after()`, TypeScript, Vitest.

**Spec note:** The original spec referenced a `setClientArchived(id, archived)` repo call. After reading the landed code, this isn't the right shape — the existing `updateClientArchiveState` repo function already covers the DB write, and the duplication lives in the route flow (auth + precondition + scheduled `after()` block + error mapping). The factory approach extracts that route flow directly. No new repo function needed.

**Refactor discipline:** Tests in `tests/unit/clients-archive-route.test.ts` cover the archive path. They import `POST` from `@/app/clients/[id]/archive/route` and mock `@/lib/auth`, `@/lib/config`, `@/lib/repositories`, `@/lib/storage/dropbox-adapter`, and `next/server`. They will continue to pass because the re-exported `POST` is a function reference and the helper imports the same modules. No new tests are added.

---

### Task 1: Extract shared archive/restore handler factory

**Files:**
- Create: `lib/clients-archive-restore.ts`
- Modify: `app/clients/[id]/archive/route.ts` (replace contents)
- Modify: `app/clients/[id]/restore/route.ts` (replace contents)

**Reference — current shape:** Both route files have the same 88-line POST body. The only differences:

| Point | Archive route | Restore route |
|---|---|---|
| Precondition | `if (client.archived_at) return conflict("Client is already archived.");` | `if (!client.archived_at) return conflict("Client is not archived.");` |
| Adapter call | `adapter.archiveClientRootFolder({ clientCodeUpper: client.code })` | `adapter.restoreClientRootFolder({ clientCodeUpper: client.code })` |
| Final state | `{ status: "completed", archiveError: null, archivedAt: new Date().toISOString() }` | `{ status: "idle", archiveError: null, archivedAt: null }` |

The shared parts (88 - ~3 changed lines = ~85 lines) include: `requireUser`, `getClientById`, `getConfiguredArchivedRoot` validation, the pending/in_progress conflict check, the initial `updateClientArchiveState` to `"pending"`, the `after()` callback skeleton (in_progress → move → rewrite paths → final state, with failure branch), and the outer `try/catch` mapping auth errors to `unauthorized` and everything else to `serverError`.

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b refactor/clients-archive-restore-dedupe
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm test tests/unit/clients-archive-route.test.ts`
Expected: 2 tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 3 "clients/\[id\]/archive\|clients/\[id\]/restore" | head -10`
Expected: at least one clone group includes `app/clients/[id]/archive/route.ts` and `app/clients/[id]/restore/route.ts` (~46 lines, multiple groups totalling ~83 lines).

- [ ] **Step 3: Create the shared handler at `lib/clients-archive-restore.ts`**

Create the file with this exact content:

```ts
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getClientById, rewriteClientDropboxPaths, updateClientArchiveState } from "@/lib/repositories";
import { DropboxStorageAdapter, getDropboxErrorSummary } from "@/lib/storage/dropbox-adapter";

type ClientArchiveRestoreMode = "archive" | "restore";

const MISSING_ROOT_MESSAGE = "DROPBOX_ARCHIVED_CLIENTS_ROOT is required to archive clients.";

function getConfiguredArchivedRoot() {
  try {
    return config.dropboxArchivedClientsRoot();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : MISSING_ROOT_MESSAGE);
  }
}

export function createClientArchiveRestoreHandler(mode: ClientArchiveRestoreMode) {
  return async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await requireUser(request);
      const { id } = await params;
      const client = await getClientById(id);
      if (!client) {
        return notFound("Client not found");
      }

      try {
        getConfiguredArchivedRoot();
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : MISSING_ROOT_MESSAGE);
      }

      const status = (client.dropbox_archive_status ?? "idle").toLowerCase();
      if (status === "pending" || status === "in_progress") {
        return conflict("Client archive is already running.");
      }
      if (mode === "archive" && client.archived_at) {
        return conflict("Client is already archived.");
      }
      if (mode === "restore" && !client.archived_at) {
        return conflict("Client is not archived.");
      }

      await updateClientArchiveState(id, {
        status: "pending",
        archiveError: null
      });

      after(async () => {
        const adapter = new DropboxStorageAdapter();
        try {
          await updateClientArchiveState(id, {
            status: "in_progress",
            archiveError: null
          });

          const moved =
            mode === "archive"
              ? await adapter.archiveClientRootFolder({ clientCodeUpper: client.code })
              : await adapter.restoreClientRootFolder({ clientCodeUpper: client.code });

          await rewriteClientDropboxPaths({
            clientId: id,
            fromRoot: moved.fromPath,
            toRoot: moved.toPath
          });

          await updateClientArchiveState(id, {
            status: mode === "archive" ? "completed" : "idle",
            archiveError: null,
            archivedAt: mode === "archive" ? new Date().toISOString() : null
          });
        } catch (error) {
          await updateClientArchiveState(id, {
            status: "failed",
            archiveError: getDropboxErrorSummary(error)
          });
        }
      });

      return ok({ pollUrl: `/clients/${id}` }, 202);
    } catch (error) {
      if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
        return unauthorized(error.message);
      }
      return serverError();
    }
  };
}
```

- [ ] **Step 4: Replace `app/clients/[id]/archive/route.ts`**

Overwrite the entire file with:

```ts
import { createClientArchiveRestoreHandler } from "@/lib/clients-archive-restore";

/**
 * Dropbox client-folder moves can take minutes for large trees, so this route returns `202 Accepted`
 * and completes the move in `after()`. v1 has no automatic retries; the UI surfaces failures and
 * re-invokes this route manually after the operator reviews the error.
 */
export const POST = createClientArchiveRestoreHandler("archive");
```

- [ ] **Step 5: Replace `app/clients/[id]/restore/route.ts`**

Overwrite the entire file with:

```ts
import { createClientArchiveRestoreHandler } from "@/lib/clients-archive-restore";

/**
 * Restore mirrors archive: return `202 Accepted`, run the Dropbox move in `after()`, and let the UI
 * poll `/clients/:id` every 2 seconds until `idle` or `failed`. v1 retries are operator-driven only.
 */
export const POST = createClientArchiveRestoreHandler("restore");
```

- [ ] **Step 6: Run client archive route tests**

Run: `pnpm test tests/unit/clients-archive-route.test.ts`
Expected: 2 tests pass.

If failures, the most likely causes:
- The factory closes over `mode` correctly but the test's `vi.mock` for `@/lib/repositories` or `@/lib/storage/dropbox-adapter` may resolve at the wrong layer. Verify the factory's imports use the `@/` aliases (matching test mocks) and not relative paths.
- A subtle conditional you flipped: archive should still hit `archiveClientRootFolder` and finish with `status: "completed"` + ISO timestamp.

- [ ] **Step 7: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: 447 passed, 3 skipped (matches main baseline).

- [ ] **Step 9: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`. The new `createClientArchiveRestoreHandler` is used by both route files; no dead exports.

- [ ] **Step 10: Run `fallow dupes` and verify the archive/restore clone groups are gone**

Run: `pnpm exec fallow dupes 2>&1 | grep -E "clients/\[id\]/(archive|restore)/route\.ts" || echo "no client archive/restore dupes"`
Expected: `no client archive/restore dupes`.

If a smaller residual dupe surfaces (e.g., the two thin re-export files might cluster as a 2-line group), document it in the PR description and accept it. Do not add a fallow ignore.

- [ ] **Step 11: Commit**

```bash
git add lib/clients-archive-restore.ts app/clients/[id]/archive/route.ts app/clients/[id]/restore/route.ts
git commit -m "$(cat <<'EOF'
refactor(clients): extract archive/restore route handler factory

Both POST handlers shared ~85 of 88 lines; only the precondition,
adapter call, and final state differed. Replace with a single
factory in lib/clients-archive-restore.ts that branches on mode.
Each route file becomes a 2-line re-export.

No behavior change. Existing clients-archive-route tests stay green.
EOF
)"
```

- [ ] **Step 12: Push and open PR**

```bash
git push -u origin refactor/clients-archive-restore-dedupe
gh pr create --title "refactor(clients): extract archive/restore route handler factory" --body "$(cat <<'EOF'
## Summary
- New `lib/clients-archive-restore.ts` exports `createClientArchiveRestoreHandler(mode)`
- `app/clients/[id]/archive/route.ts` and `.../restore/route.ts` reduce to 2-line re-exports
- No behavior change

## Why
PR 2 of 9 in the fallow dupes cleanup series (see `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`). Removes the ~46-line clone group between the two client archive/restore routes (originally flagged as 3 clone groups, ~83 lines combined).

## Test plan
- [x] `pnpm test tests/unit/clients-archive-route.test.ts` — 2 tests pass
- [x] `pnpm test` — 447 pass / 3 skipped (matches main baseline)
- [x] `pnpm exec tsc --noEmit` — clean
- [x] `pnpm exec fallow dead-code` — clean
- [x] `pnpm exec fallow dupes` — no `app/clients/[id]/(archive|restore)/route.ts` clone groups remain
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Implements PR 2 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. Spec called for `setClientArchived` + a route wrapper; this plan adjusts to a factory pattern after reading the landed code (the existing `updateClientArchiveState` already handles the DB layer; the duplication is purely in the route flow). The plan documents this adjustment in the header.
- **Placeholders:** none.
- **Type consistency:** `ClientArchiveRestoreMode = "archive" | "restore"` is the only new type. `createClientArchiveRestoreHandler(mode)` returns a function whose signature `(request: Request, { params }: { params: Promise<{ id: string }> }) => Promise<Response>` matches both existing route files exactly.
- **Scope:** one new file, two replaced files, single PR, single fallow clone-group family cleared.
