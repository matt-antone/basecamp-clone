# Editable clients (Settings) implementation plan

> **STATUS: CLOSED** (2026-03-31) — `PATCH` client route, repository update, settings UI, and route tests (`clients-patch-route.test.ts`) are in-repo. Do not dispatch new work from this document without authoring a new plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit a client’s **display name** from Settings → Client List via a shared native `<dialog>` for add and edit; **client code stays immutable** after creation (name-only `PATCH`).

**Architecture:** Add `updateClientName` in the Postgres repository layer and a new App Router handler `PATCH /clients/[id]` that validates `{ name }` with Zod and matches auth/error patterns from `app/clients/route.ts`. Replace the inline “add client” form on `app/settings/page.tsx` with an **Add client** button plus **Edit** per row; both open the same dialog (create vs edit mode; code field disabled in edit with helper copy). On success, close the dialog and call existing `loadClients`.

**Tech Stack:** Next.js App Route handlers, `requireUser`, `zod`, existing `authedFetch` / `authedJsonFetch` on the settings page, Vitest + `vi.mock` for route unit tests (same style as `tests/unit/site-settings-route.test.ts`).

**Specification:** [`docs/superpowers/specs/2026-03-31-editable-clients-settings-design.md`](../specs/2026-03-31-editable-clients-settings-design.md)

---

## File map

| File | Role |
|------|------|
| [`lib/repositories.ts`](../../../lib/repositories.ts) | Add `updateClientName(id, name)` after `getClientById` |
| [`app/clients/[id]/route.ts`](../../../app/clients/[id]/route.ts) | **Create:** `PATCH` only; `requireUser`, Zod, `updateClientName`, `ok` / `notFound` / `badRequest` / `unauthorized` / `serverError` |
| [`app/settings/page.tsx`](../../../app/settings/page.tsx) | Client tab: dialog, refs, mode state, wire POST vs PATCH |
| [`tests/unit/clients-id-route.test.ts`](../../../tests/unit/clients-id-route.test.ts) | **Create:** mocks for auth + repo; success, 400, 404, 401 |

**Unchanged:** `app/clients/route.ts` (GET/POST), DB schema, project identity columns.

**Dialog reference:** [`components/projects/projects-workspace-context.tsx`](../../../components/projects/projects-workspace-context.tsx) uses `useRef<HTMLDialogElement | null>(null)` and `createDialogRef.current?.showModal()` / `.close()`; [`components/projects/projects-workspace-shell.tsx`](../../../components/projects/projects-workspace-shell.tsx) wraps content in `<dialog ref={...} className="dialog">`.

---

### Task 1: Unit tests for `PATCH /clients/[id]` (write first)

**Files:**
- Create: `tests/unit/clients-id-route.test.ts`
- Modify: none yet

- [x] **Step 1: Add the test file with mocked dependencies**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const updateClientNameMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  updateClientName: updateClientNameMock
}));

describe("PATCH /clients/[id]", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    updateClientNameMock.mockReset();
  });

  it("returns 200 and client when name updates", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    updateClientNameMock.mockResolvedValue({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Acme Corp",
      code: "ACME"
    });

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "  Acme Corp  " })
      }),
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      client: {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Acme Corp",
        code: "ACME"
      }
    });
    expect(updateClientNameMock).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "  Acme Corp  "
    );
  });

  it("returns 400 when name is empty after validation", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "   " })
      }),
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) }
    );

    expect(response.status).toBe(400);
    expect(updateClientNameMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no client row updated", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    updateClientNameMock.mockResolvedValue(null);

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Valid Name" })
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns 401 when requireUser throws", async () => {
    requireUserMock.mockRejectedValue(new Error("Invalid token"));

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" })
      }),
      { params: Promise.resolve({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }) }
    );

    expect(response.status).toBe(401);
  });
});
```

- [x] **Step 2: Run tests — expect failures (route and `updateClientName` missing)**

Run: `cd basecamp-clone && npx vitest run tests/unit/clients-id-route.test.ts`  
Expected: FAIL (cannot resolve `@/app/clients/[id]/route` or `updateClientName`).

- [x] **Step 3: Commit (optional checkpoint)**

```bash
git add tests/unit/clients-id-route.test.ts
git commit -m "test: add failing PATCH /clients/[id] route tests"
```

---

### Task 2: Repository — `updateClientName`

**Files:**
- Modify: `lib/repositories.ts` (after `getClientById`, ~line 139)

- [x] **Step 1: Implement the function**

```typescript
export async function updateClientName(id: string, name: string) {
  const trimmed = name.trim();
  const result = await query(`update clients set name = $1 where id = $2::uuid returning *`, [
    trimmed,
    id
  ]);
  return result.rows[0] ?? null;
}
```

**Note:** Trimming happens in the repository so the route can pass the raw string from JSON and tests that assert call arguments stay aligned with “route passes body name”; alternatively trim only in the route and pass trimmed to `updateClientName` — pick one place and keep tests consistent.

- [x] **Step 2: No standalone repo test required** (per design: route tests suffice).

- [x] **Step 3: Commit**

```bash
git add lib/repositories.ts
git commit -m "feat: add updateClientName for clients table"
```

---

### Task 3: App route `PATCH /clients/[id]`

**Files:**
- Create: `app/clients/[id]/route.ts`

- [x] **Step 1: Implement the handler**

```typescript
import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { updateClientName } from "@/lib/repositories";
import { z } from "zod";

const patchClientSchema = z.object({
  name: z.string().transform((s) => s.trim()).pipe(z.string().min(1))
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const payload = patchClientSchema.parse(await request.json());
    const client = await updateClientName(id, payload.name);
    if (!client) {
      return notFound("Client not found");
    }
    return ok({ client });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
```

If your `updateClientName` signature is `(id, rawName)` and trims inside the function, pass `payload.name` after Zod (already trimmed by schema) — then repository can use `name` as-is without double-trim, or keep repository trim as a safety net.

- [x] **Step 2: Run route tests**

Run: `cd basecamp-clone && npx vitest run tests/unit/clients-id-route.test.ts`  
Expected: PASS (adjust the first test’s `toHaveBeenCalledWith` if you pass trimmed name only).

- [x] **Step 3: Typecheck**

Run: `cd basecamp-clone && npx tsc --noEmit`  
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add app/clients/[id]/route.ts
git commit -m "feat: PATCH /clients/[id] for client display name"
```

---

### Task 4: Settings page — shared dialog for add and edit

**Files:**
- Modify: `app/settings/page.tsx`

- [x] **Step 1: Extend React imports**

```typescript
import { useEffect, useRef, useState } from "react";
```

- [x] **Step 2: Replace inline add state with dialog-oriented state**

Remove standalone `name` / `code` if you fully move create into the dialog, or keep them as `dialogName` / `dialogCode` to avoid clashing with profile `name` (there is no clash today — `name` is client name only). Recommended names for clarity:

- `clientDialogRef = useRef<HTMLDialogElement | null>(null)`
- `clientDialogMode: "create" | "edit" | null` (or boolean `editingClientId: string | null` where `null` means create when dialog opens from Add)
- `dialogClientId: string | null` (set when editing)
- `dialogName`, `dialogCode` — form fields inside dialog

- [x] **Step 3: Open helpers**

```typescript
function openCreateClientDialog() {
  setClientDialogMode("create");
  setDialogClientId(null);
  setDialogName("");
  setDialogCode("");
  clientDialogRef.current?.showModal();
}

function openEditClientDialog(client: ClientRecord) {
  setClientDialogMode("edit");
  setDialogClientId(client.id);
  setDialogName(client.name);
  setDialogCode(client.code);
  clientDialogRef.current?.showModal();
}
```

- [x] **Step 4: Submit handler**

```typescript
async function submitClientDialog() {
  if (!token) return;
  if (clientDialogMode === "create") {
    await authedFetch(token, "/clients", {
      method: "POST",
      body: JSON.stringify({ name: dialogName, code: dialogCode })
    });
  } else if (clientDialogMode === "edit" && dialogClientId) {
    await authedFetch(token, `/clients/${dialogClientId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: dialogName })
    });
  }
  clientDialogRef.current?.close();
  setClientDialogMode(null);
  await loadClients(token);
}
```

Wrap in `.catch((error) => setStatus(error instanceof Error ? error.message : "Request failed"))` like other actions. Match duplicate-code error handling from existing `createClient` path.

- [x] **Step 5: Replace Client List tab markup**

- Remove the always-visible `.form` with two inputs + Add button from the clients section (~lines 342–351).
- Add **Add client** `OneShotButton` calling `openCreateClientDialog`.
- List: each `<li>` shows code, name, and **Edit** → `openEditClientDialog(client)`.
- After `</section>` for clients tab (or inside it, portal-style), add:

```tsx
<dialog ref={clientDialogRef} className="dialog" onClose={() => setClientDialogMode(null)}>
  <div className="stackSection">
    <h3>{clientDialogMode === "edit" ? "Edit client" : "Add client"}</h3>
    <div className="form">
      <label>
        Name
        <input
          value={dialogName}
          onChange={(e) => setDialogName(e.target.value)}
          placeholder="Client name"
        />
      </label>
      <label>
        Code
        <input
          value={dialogCode}
          onChange={(e) => setDialogCode(e.target.value.toUpperCase())}
          disabled={clientDialogMode === "edit"}
          placeholder="e.g. ACME"
        />
      </label>
      {clientDialogMode === "edit" ? (
        <p className="muted">Code can’t be changed after the client is created.</p>
      ) : null}
      <div className="formActions">
        <OneShotButton type="button" onClick={() => clientDialogRef.current?.close()}>
          Cancel
        </OneShotButton>
        <OneShotButton
          type="button"
          onClick={() => submitClientDialog().catch(...)}
          disabled={
            clientDialogMode === "create"
              ? !dialogName.trim() || !dialogCode.trim()
              : !dialogName.trim()
          }
        >
          {clientDialogMode === "edit" ? "Save" : "Add"}
        </OneShotButton>
      </div>
    </div>
  </div>
</dialog>
```

Use existing class names from `app/styles.css` if `muted` / `formActions` do not exist — align with `ProjectDialogForm` or other dialogs (e.g. reuse `form` row layout only).

- [x] **Step 6: Manual QA**

1. Settings → Client List → **Add client**: create with name + code; list refreshes.
2. **Edit**: change name only; code field disabled; save; list shows new name.
3. Invalid token / network: status line updates.

- [x] **Step 7: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(settings): client add/edit dialog with name-only PATCH"
```

---

## Self-review (plan author)

**1. Spec coverage**

| Design section | Task |
|----------------|------|
| Name-only PATCH | Task 3 schema + Task 4 submit |
| Code immutable on edit | Task 4 disabled input + copy |
| Shared dialog add + edit | Task 4 |
| `updateClientName` SQL | Task 2 |
| Tests for PATCH | Task 1 + 3 |
| Out of scope (delete, code change) | Not in tasks |

**2. Placeholder scan:** None intentional; adjust CSS class names to match the repo if `muted` / `formActions` are missing.

**3. Type consistency:** `updateClientName(id, string)`; Zod output `name` is trimmed string; 404 when `null` row.

**4. Test assertion note:** After Task 3, if the route passes trimmed `payload.name` to `updateClientName` and the first test expected raw `"  Acme Corp  "`, update the expectation to `"Acme Corp"`.

---

## Execution handoff

**Plan complete and saved to** `docs/superpowers/plans/2026-03-31-editable-clients-settings.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Dispatch a fresh subagent per task; review between tasks.
2. **Inline execution** — Run tasks in one session with checkpoints between Task 1–4.

**Which approach?**

