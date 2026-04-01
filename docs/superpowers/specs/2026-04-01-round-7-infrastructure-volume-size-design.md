# Round 7 — Increase volume size (infrastructure)

**Date:** 2026-04-01  
**Status:** Draft (brainstorm Round 7)  
**Type:** Infrastructure / capacity

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **Situation** | **Not** out of space — **proactive** headroom request. |
| **Current allocation** | **1 GB** volume; **~150 MB** in use (~15%). |
| **Host category** | **D** — platform with an explicit attachable volume (not Vercel; not Supabase DB disk). Typical: **Fly.io / Railway / Render** or similar PaaS with volumes, or VPS. **Exact provider still TBD** for the runbook (name it when resizing). |
| **Rationale** | 1 GB feels **small** for growth (deps, Docker layers, logs, local cache on the volume). |

---

## Problem

The deployment uses a **1 GB** volume that is **not yet full** (~150 MB used) but is **tight for growth**. The team wants a **larger allocation** before hitting limits.

---

## Goal

**Increase** the volume (or plan tier) to a **comfortable** size for expected growth, using the **host provider’s** resize or upgrade path.

---

## Open question (optional)

**Which exact provider?** (Fly vs Railway vs Render vs VPS, etc.) — needed only to write the precise **runbook** step list; does not block the product decision above.

---

## Non-goals

- Application code changes unless the root cause is **unbounded local file writes** (then fix code + resize).

---

## Requirements

1. Confirm **current** usage (`df -h` or dashboard) before/after — baseline ~150 MB / 1 GB.
2. Apply **provider-documented** resize or plan upgrade (no secret rotation in repo).
3. **Verify:** build/deploy succeeds; set an **alert** or calendar check before 70–80% of new capacity if possible.

---

## Deliverable

Short **runbook** entry (can live in this spec or internal wiki): before/after size, date, who performed, rollback N/A.

---

## Related

- If the issue is **uploads**: consider Vercel Blob / S3 and retention policy instead of VM disk alone.
