# Split index — transition sync + thumbnail enqueue

**Date:** 2026-03-31  
**Status:** Superseded by two focused specs

This file previously combined **two independent concerns** in one document. For clarity, each concern now has its own spec:

| Concern | Spec |
|---------|------|
| **Scheduled BC2 → app migration** (cron, runners, idempotency, secrets) | [2026-03-31-transition-nightly-bc2-sync-design.md](./2026-03-31-transition-nightly-bc2-sync-design.md) |
| **Enqueue thumbnail jobs after Dropbox + `project_files` insert** | [2026-03-31-thumbnail-enqueue-after-save-design.md](./2026-03-31-thumbnail-enqueue-after-save-design.md) |

Implement and plan them **separately**; either can ship first.

**Implementation plans** (when written) should live as two files under `docs/superpowers/plans/`, one per spec — not one combined plan.
