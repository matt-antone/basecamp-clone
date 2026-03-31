# Editable clients list on Settings (dialog) — Design

**Date:** 2026-03-31  
**Status:** Awaiting review  
**Scope:** Settings → Client List tab; name-only edits; single native `<dialog>` for add and edit

---

## Overview

Users can change a client’s **display name** after creation. The **client code** never changes once the row exists, so project labels that incorporate the code stay stable and we avoid re-labeling or bulk project updates.

The Client List tab moves **add** and **edit** into one shared **dialog** (same field layout: name + code). In edit mode the code field is read-only with short helper copy.

---

## Product rules

| Rule | Detail |
|------|--------|
| Create | Name + code required; code normalized to uppercase; same validation as today’s POST (`/clients`). |
| Edit | `PATCH` accepts **name only**; code is not writable in the API for updates. |
| Delete | Out of scope for this change. |

---

## API

**New route:** `PATCH /clients/[id]`

- **Auth:** `requireUser(request)` (same as existing `app/clients/route.ts`).
- **Body:** `{ name: string }` — zod: trimmed, `min(1)` (align with create semantics for name).
- **Behavior:** Update `clients.name` where `id` matches; return `200` + `{ client }` (full row as elsewhere).
- **Errors:** `401` auth; `400` validation; `404` if no row for `id`; `500` on unexpected failure.

**Existing:** `GET /clients`, `POST /clients` unchanged.

---

## Data layer

**`lib/repositories.ts`**

- Add `updateClientName(id: string, name: string)` executing:
  `update clients set name = $1 where id = $2 returning *`
- Reuse `getClientById` for existence check in the route, or rely on `UPDATE … RETURNING` row count (prefer clear 404 when zero rows updated).

**Schema:** No migration; `clients` table already has `name`, `code`, `id`.

---

## UI — `app/settings/page.tsx` (Client List tab)

- **List:** Each row shows code, name, and an **Edit** action that opens the dialog in edit mode with that client pre-filled.
- **Add:** Replace the always-visible inline add form with a button (e.g. **Add client**) that opens the dialog in create mode (empty name, empty code).
- **Dialog:** Native `<dialog>`, consistent with `components/projects/projects-workspace-shell.tsx` (ref + `showModal()` / `close()` or equivalent single pattern in this file).
- **Fields:** Name input; code input disabled in edit mode with explanatory text (“Code can’t be changed after the client is created”).
- **Submit:** Create → `POST /clients`; Edit → `PATCH /clients/[id]`; on success close dialog, clear create fields, call existing list refresh (`loadClients`).
- **Errors:** Use the page’s existing status line and/or inline dialog error messaging consistent with create-client behavior today.

---

## Testing

- **Route:** Integration or unit tests for `PATCH` — valid name, empty name (400), unknown id (404), if the project already tests similar `app/*` routes.
- **Repository (optional):** Thin test for `updateClientName` if test DB patterns exist; otherwise route tests suffice.

---

## Out of scope

- Deleting clients  
- Changing client code  
- Recomputing `project_code` / stored labels when name changes (name-only does not require it)

---

## Self-review checklist

- [x] No TBD placeholders  
- [x] Aligns with **name-only** edit (decision A)  
- [x] Single implementation slice (settings + one new route + one repo function)  
- [x] No ambiguous PATCH body (name only)
