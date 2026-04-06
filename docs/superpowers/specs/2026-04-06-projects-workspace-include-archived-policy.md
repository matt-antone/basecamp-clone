# Projects workspace — `includeArchived` policy (list / board context)

**Date:** 2026-04-06  
**Status:** Adopted  
**Code:** `components/projects/projects-workspace-context.tsx` — `buildProjectsUrl()`

---

## Rule (do not regress)

**`loadProjectsBootstrap`, `refreshProjects`, and any URL built by `buildProjectsUrl` MUST use `includeArchived=false`** when calling `GET /projects` for the shared workspace (home list, board, and any screen that uses `ProjectsWorkspaceProvider` for the same `projects` array).

Do **not** switch this back to `true` for “consistency” without:

1. Measuring impact on **`GET /projects`** latency and payload size, and  
2. A product decision that the list/board context must hold **archived** rows in memory (today it does not need them).

---

## Rationale

- The UI only renders **non-archived** projects for list and board (`activeProjects` filters `!project.archived`). Fetching archived rows added DB work, transfer time, and memory for **no user-visible benefit** on `/`, `/flow`, `/billing`, or `/archive` shell.
- **Archived projects** are listed and searched via **`GET /projects/archived`** (`components/projects/archive-tab.tsx`), not via the workspace `projects` state.
- **Billing** uses **`GET /projects?billingOnly=true&includeArchived=false`** independently.

---

## API note

`GET /projects` still supports **`includeArchived=true`** for callers that need the full set. The **workspace client** is the place that pins **`false`** for performance.

---

## Related specs (keep in sync)

When editing these, preserve **`includeArchived=false`** for workspace bootstrap/refresh unless this policy is explicitly revised:

- [2026-03-31-projects-workspace-ux-search-design.md](./2026-03-31-projects-workspace-ux-search-design.md)
- [2026-03-31-projects-rollup-ux-design.md](./2026-03-31-projects-rollup-ux-design.md) (client dropdown rules reference the same `GET /projects` params)
