# Fallow Dupes Cleanup — Design

**Date:** 2026-04-29
**Status:** Approved

## Goal

Drive `fallow dupes` to zero clone groups across `app/`, `lib/`, `components/`, and `tests/`. Once at zero, gate CI on `fallow dupes` so duplication cannot regress.

## Non-Goals

- **`scripts/`** is excluded. One-shot CLI tools where refactor cost exceeds benefit. Configure via `.fallowrc.json` `duplicates.ignore`.
- No unrelated refactoring. Each PR addresses only the dupes it targets.

## Strategy

**Refactor first, gate after.** Don't add `fallow dupes` to CI until count is zero. No baseline file to maintain.

**Bottom-up sequencing.** Easy wins first to build pattern understanding before tackling the route handler wrapper, which is the highest-stakes design decision.

**Independent PRs off `main`.** No long-lived branch, no stacked PRs. Each phase lands on its own.

## PR Series

### Phase 1 — small internal/pair dupes (4 PRs)

1. **`lib/mailer.ts` internal dupe**
   - Lines 138–196 ↔ 228–280 (59 lines). Two near-identical email-builder blocks.
   - Extract one shared HTML/text email builder helper.

2. **`app/clients/[id]/{archive,restore}` routes**
   - 46 lines × 2 → 1 helper.
   - Extract `setClientArchived(id, archived: boolean)` repo call + shared route wrapper that takes `archived` as a parameter.

3. **`app/projects/[id]/{archive,restore}` routes**
   - 32 lines × 2. Same pattern as #2.

4. **`app/projects/[id]/{archived-hours,my-hours}` routes**
   - 25 lines. Shared hours-query helper.

These are mechanical: same pattern, archived/state as a parameter. Establishes the "shared route helper" idiom for later phases.

### Phase 2 — medium structural (2 PRs)

5. **`app/profile/route.ts` ↔ `app/site-settings/route.ts`**
   - 46 lines. Both are PATCH-with-validation.
   - Extract `withPatchValidation(schema, handler)` pattern.

6. **`components/projects/projects-board.tsx` ↔ `projects-list.tsx`**
   - 4 groups, 173 lines. Same project data, different layouts.
   - Extract `useProjectsView()` hook for filter/sort/column logic.
   - View components stay purely presentational.

### Phase 3 — route handler wrapper (1 PR, biggest design decision)

7. **POST handlers across `app/`**
   - `app/projects/[id]/threads/route.ts`
   - `app/projects/[id]/threads/[threadId]/comments/route.ts`
   - `app/projects/[id]/files/upload-init/route.ts`
   - `app/projects/route.ts`
   - ~287 lines duplicated across these POSTs.
   - Extract `withAuthedJson(schema, handler)`: auth check → zod validate → handler → JSON response → error wrapper.
   - Phases 1–5 will have shaped what this wrapper looks like.

### Phase 4 — cleanup (1 PR)

8. **Test scaffolding + CI gate**
   - Some test dupes (e.g. `project-archive-route.test.ts` ↔ `project-restore-route.test.ts`) resolve naturally as source dupes go away.
   - Remaining ones get a shared test fixture helper.
   - Add `pnpm exec fallow dupes` step to `.github/workflows/ci.yml`.
   - Update `.fallowrc.json` to set `duplicates.ignore` for `scripts/**`.

**Total: 9 PRs.**

## Design Constraints

- Each PR must leave `fallow dead-code` clean (existing CI gate).
- Each PR must leave `pnpm test` and `pnpm exec tsc --noEmit` clean.
- Each PR must zero out the dupe groups it targets — no partial fixes.
- View / presentational components in Phase 2.6 must not own data-fetching or filter state.

## Risks

- **Wrapper over-abstraction (Phase 3).** Easy to design a `withAuthedJson` that doesn't actually fit all four POSTs. Mitigation: phases 1–5 inform the shape; if the four routes have meaningfully different shapes, accept 2–3 of them as out of scope and re-evaluate.
- **`useProjectsView` hook (Phase 2.6) coupling.** Risk that the hook ends up tightly bound to one view. Mitigation: write the hook against both views simultaneously; don't merge until both consume it cleanly.
- **Test refactor (Phase 4).** Test scaffolding duplication is often intentional — DAMP > DRY. If a "shared fixture" obscures what each test is doing, leave the dupe and add a fallow ignore.

## CI

- Current: `fallow dead-code` runs in CI.
- After Phase 4: add `fallow dupes` step. Hard fail on any clone group outside `scripts/**`.
