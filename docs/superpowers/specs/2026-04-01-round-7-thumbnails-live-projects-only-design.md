# Round 7 — Thumbnail queue: live projects only

**Date:** 2026-04-01  
**Status:** Draft (brainstorm Round 7)  
**Type:** Performance / cost containment

---

## Problem

Thumbnail generation for project files **does not need to run** for **archived** projects at the same priority as active work. Queuing work for archived projects increases worker load and storage churn without proportional user value.

---

## Goal

**Only enqueue** thumbnail jobs when the **project is not archived** (or equivalent “live” status). Archived projects **do not** enqueue thumbnails “from the start” — i.e. upload paths and nightly/sync paths should **not** schedule thumbnails for archived projects.

---

## Scope

| Path | Behavior |
|------|----------|
| **Upload complete** (`POST .../upload-complete` or similar) | If `project.archived === true`, **skip** `enqueueThumbnailJobAndNotifyBestEffort` (or equivalent). |
| **Nightly / sync** | Same guard: skip when project archived. |
| **Restore** | Optional follow-up: if product wants thumbnails after restore, enqueue on restore or next file touch (out of scope unless explicitly added). |

---

## Non-goals

- Deleting existing thumbnails for archived projects.
- Changing thumbnail dimensions or worker implementation.

---

## Requirements

1. **Central guard** (single helper) preferred: e.g. `shouldEnqueueThumbnailForProject(project)` in `lib/thumbnail-enqueue-after-save.ts` or a thin wrapper.
2. **Logging:** debug-level skip reason for “archived project” (optional).
3. **Tests:** extend `tests/unit/thumbnail-enqueue-after-save.test.ts` and `upload-complete-route.test.ts` (or BC2 migrate tests) to assert **no enqueue** when archived.

---

## Related

- `lib/thumbnail-enqueue-after-save.ts`
- Spec: `docs/superpowers/specs/2026-03-31-thumbnail-enqueue-after-save-design.md`
