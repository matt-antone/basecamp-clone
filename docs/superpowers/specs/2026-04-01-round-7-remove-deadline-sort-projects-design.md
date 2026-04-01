# Round 7 — Remove deadline sort from projects page

**Date:** 2026-04-01  
**Status:** Draft (brainstorm Round 7)  
**Type:** UX / bug containment

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **API vs UI** | **Option A (minimal)** — `GET /projects` **continues** to accept **`sort=deadline`** and `listProjects` **keeps** the deadline `ORDER BY` branch for **backward compatibility** (bookmarks, scripts). **Only the UI** drops the Deadline sort control. |
| **Bookmark / URL `?sort=deadline`** | **N/A during development** — no production bookmark debt yet. **No required** client-side URL rewrite on load; implementer may **strip or replace** opportunistically for cleanliness, or **leave** URL as-is. Revisit before public launch if product wants strict URL hygiene. |

---

## Problem

**Deadline** sort on the projects workspace is **not working** as expected. Rather than invest in a fix in this round, product asks to **remove** the deadline sort option from the projects page **UI only**; the API remains unchanged per § Resolved.

---

## Goal

1. Users **cannot** select “sort by deadline” on list/board (remove from `<select>` or segmented control).
2. Default / remaining sorts (e.g. **Title**) continue to work; **search** behavior unchanged (FTS relevance when search active per existing spec).
3. Reduce confusion: no dead control.

---

## Non-goals

- Re-implementing deadline sort correctly (may be a future spec).
- Removing **deadline display** from rows/cards (display stays unless separately requested).

---

## API / repository

| Decision | Detail |
|----------|--------|
| **Option A (minimal)** | Keep `sort=deadline` in `listProjects` for backward compatibility but remove UI; document as unused. |
| **Option B (strict)** | Remove `deadline` from `ListProjectsOptions`, route parsing, and `ORDER BY` branch in `lib/repositories.ts`; update tests in `tests/unit/projects-route.test.ts`. |

**Chosen:** **A** — see § Resolved.

---

## Requirements

1. Projects workspace UI has no “Deadline” sort entry.
2. New user actions must not set `sort=deadline` from the sort control. **Bookmark URL rewrite:** not required pre-launch — see § Resolved.
3. **Tests:** Keep or extend **API** coverage for `sort=deadline` where Option A applies; remove/adjust **UI-only** tests that assumed the control exists.

---

## Related

- `lib/repositories.ts` — `sort === "deadline"` branch.
- `app/projects/route.ts` — `sort` query parsing.
- `components/projects/projects-workspace-context.tsx` — URL builder / sort state.
- `tests/unit/projects-route.test.ts` — deadline sort cases.
