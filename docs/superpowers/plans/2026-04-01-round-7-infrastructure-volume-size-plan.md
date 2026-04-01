# Round 7 — Increase volume size — implementation plan

**Status:** Pending  
**Spec:** [2026-04-01-round-7-infrastructure-volume-size-design.md](../specs/2026-04-01-round-7-infrastructure-volume-size-design.md)

**Context (resolved):** Proactive resize — **1 GB** volume, **~150 MB** used; host category **D** (PaaS with volume / VPS — name provider in runbook).

---

## Goal

Increase **volume or plan** capacity for growth before hitting limits (not firefighting an outage).

---

## Tasks

- [ ] **Step 1:** Record **baseline** (`df -h` or dashboard): ~150 MB / 1 GB.
- [ ] **Step 2:** Name **provider** (Fly / Railway / Render / other) in spec runbook for precise steps.
- [ ] **Step 3:** Follow provider steps to increase disk/volume or upgrade plan (pick a target size with headroom — e.g. **5–10 GB** unless cost constraints).
- [ ] **Step 4:** If code contributes (temp files, huge `node_modules` in wrong place), file a **separate** small bugfix — do not mix with infra resize unless necessary.
- [ ] **Step 5:** Verify: redeploy, run smoke test, confirm free space metric.

---

## Notes

- **Do not** commit secrets or edit `.env.local` as part of volume changes unless explicitly required for a new storage backend.

---

## Verification

- New capacity visible in dashboard / `df`; app healthy after resize.
- Optional: usage alert before ~80% of new quota.
