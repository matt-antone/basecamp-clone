# PM-Relay Rebranding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from "basecamp-clone" to "PM-Relay" across the codebase without touching BC2 import source-system references or historical docs.

**Architecture:** Pure string and file-rename refactor, executed as a series of small, commit-per-task changes. One behavioral change (theme localStorage key migration) gets proper TDD treatment via a pure helper function; everything else is deterministic text replacement with build and test verification at the end.

**Tech Stack:** Next.js 15 (App Router), Supabase Edge Functions (Deno), Vitest.

**Spec reference:** `docs/superpowers/specs/2026-04-10-rebranding-pm-relay-design.md`

---

## CRITICAL RULES — READ BEFORE EVERY TASK

These are product vs. source-system boundaries. Violating them destroys the BC2 import pipeline or falsifies project history.

### MUST rename (product name):
- `basecamp-clone` (lowercase, hyphen)
- `Basecamp Clone` (title case)
- `"Basecamp 2 replacement..."` in the site description (lib/site-branding.ts only)

### MUST NOT rename (BC2 = source system we import FROM):
- `basecamp2` (the endpoint `/admin/imports/basecamp2` and related)
- `bc2` (scripts, lib files, tests, migrations)
- `Basecamp 2` as prose referring to the source system
- Any file under `scripts/migrate-bc2*`, `scripts/backfill-bc2*`, `scripts/reset-bc2*`
- Any file under `lib/imports/bc2-*`
- Any file matching `supabase/migrations/*bc2*`
- Any test matching `tests/**/*bc2*`
- Any route under `app/admin/imports/basecamp2/**`

### MUST NOT rewrite (historical records):
- `docs/superpowers/plans/closed/**`
- `docs/superpowers/specs/**` (except the rebranding spec itself — and even that only to fix typos, not change content)
- `docs/_archive/**`
- `docs/superpowers/handoffs/**`
- `docs/superpowers/plans/2026-04-09-mcp-file-upload.md` (active, unrelated)
- `docs/superpowers/plans/2026-04-10-email-notifications-fix.md` (active, unrelated)

### Working directory:
All commands run from the repo root:
`/Volumes/External/Glyphix Dropbox/Development Files/Under Development/Project Manager/basecamp-clone`

---

## File Structure Overview

**New/renamed files:**
- `docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md` (renamed from `...basecamp-clone-layer-agents.md`)
- `supabase/functions/pm-relay-mcp/` directory (renamed from `basecamp-mcp/`)
- `lib/theme-storage.ts` (new — pure helper for localStorage theme key fallback)
- `tests/unit/theme-storage.test.ts` (new — unit test for helper)

**Modified files:**
- `package.json`
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `lib/site-branding.ts`
- `app/header.tsx`
- `app/layout.tsx`
- `supabase/config.toml`
- `supabase/functions/pm-relay-mcp/index.ts`
- `supabase/functions/pm-relay-mcp/tools.ts`
- `supabase/functions/pm-relay-mcp/db.ts`
- `supabase/functions/pm-relay-mcp/notify.ts`
- `.cursor/rules/import-layer-agents.mdc`
- `plan.md` (check and possibly delete)

---

## Task 0: Pre-flight — Snapshot BC2 file set

**Purpose:** Capture the list of files that reference BC2 source-system strings. Re-running the same command after all changes must produce identical output, proving BC2 code was untouched.

**Files:** (read only)

- [ ] **Step 1: Capture BC2 reference snapshot**

Run:
```sh
rg -l '\b(bc2|basecamp2)\b' \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!.next' \
  --glob '!package-lock.json' \
  --glob '!.claude/worktrees/**' \
  --glob '!docs/_archive/**' \
  | sort > /tmp/pm-relay-bc2-snapshot.txt
wc -l /tmp/pm-relay-bc2-snapshot.txt
cat /tmp/pm-relay-bc2-snapshot.txt
```

Expected: a non-empty list containing things like `scripts/migrate-bc2.ts`, `lib/imports/bc2-*.ts`, `supabase/migrations/*bc2*.sql`, etc. Record the file count.

- [ ] **Step 2: Capture product-name reference snapshot (informational)**

Run:
```sh
rg -l '(basecamp-clone|Basecamp Clone)' \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!.next' \
  --glob '!package-lock.json' \
  --glob '!.claude/worktrees/**' \
  --glob '!docs/_archive/**' \
  --glob '!docs/superpowers/plans/closed/**' \
  --glob '!docs/superpowers/handoffs/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/plans/2026-04-09-mcp-file-upload.md' \
  --glob '!docs/superpowers/plans/2026-04-10-email-notifications-fix.md' \
  | sort > /tmp/pm-relay-product-snapshot.txt
cat /tmp/pm-relay-product-snapshot.txt
```

Expected: the list of files this plan will touch. Task 14 verifies this list becomes empty.

- [ ] **Step 3: No commit (audit only)**

---

## Task 1: Rename the layer-agents doc file

**Files:**
- Rename: `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md` → `docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md`
- Modify: the renamed file's contents (heading, repo root, memory namespace, chat prompt reference)

- [ ] **Step 1: Rename file via git mv**

Run:
```sh
git mv docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md \
       docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md
```

- [ ] **Step 2: Update heading (line 1)**

Find: `# basecamp-clone: layer-ordered specialized agents`
Replace with: `# PM-Relay: layer-ordered specialized agents`

- [ ] **Step 3: Update repo root reference (line 5)**

Find: `**Repo root:** \`basecamp-clone/\``
Replace with: `**Repo root:** \`pm-relay/\``

- [ ] **Step 4: Update memory namespace URL (line 6)**

Find: `https://github.com/matt-antone/basecamp-clone.git`
Replace with: `https://github.com/matt-antone/pm-relay.git`

- [ ] **Step 5: Update chat-prompt reference (line 127 area)**

Find: `@docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md`
Replace with: `@docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md`

- [ ] **Step 6: Verify no stragglers in the renamed file**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md
```
Expected: no output.

- [ ] **Step 7: Commit**

```sh
git add docs/superpowers/agents/
git commit -m "rebrand: rename layer-agents doc to PM-Relay"
```

---

## Task 2: Update `.cursor/rules/import-layer-agents.mdc` to reference the new doc path

**Files:**
- Modify: `.cursor/rules/import-layer-agents.mdc`

- [ ] **Step 1: Replace the agents doc path**

Find: `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md`
Replace with: `docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md`

- [ ] **Step 2: Check for any other basecamp-clone references in the file**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' .cursor/rules/import-layer-agents.mdc
```
Expected: no output.

- [ ] **Step 3: Commit**

```sh
git add .cursor/rules/import-layer-agents.mdc
git commit -m "rebrand: update cursor rule to PM-Relay agents doc path"
```

---

## Task 3: Update `CLAUDE.md` and `AGENTS.md` (in-repo)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

Both files contain identical project-guide content. All edits below apply to both files.

**Note:** There is also a copy of `CLAUDE.md` at `../CLAUDE.md` (parent "Project Manager" directory) shown in the user's environment. That file is outside this git repo and MUST NOT be touched by this plan. Only modify the two files at the repo root.

- [ ] **Step 1: Update heading (line 1) in both files**

Find: `# Basecamp Clone Project Guide`
Replace with: `# PM-Relay Project Guide`

- [ ] **Step 2: Update the agents doc path reference in both files**

Find: `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md`
Replace with: `docs/superpowers/agents/2026-03-31-pm-relay-layer-agents.md`

- [ ] **Step 3: Update the memory namespace URL (two occurrences in each file)**

Find: `https://github.com/matt-antone/basecamp-clone.git`
Replace with: `https://github.com/matt-antone/pm-relay.git`

Use `replace_all` to catch both occurrences in each file.

- [ ] **Step 4: Verify no stragglers**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' CLAUDE.md AGENTS.md
```
Expected: no output.

Note: prose references to "Basecamp 2 import" MUST remain — those are source-system references.

- [ ] **Step 5: Commit**

```sh
git add CLAUDE.md AGENTS.md
git commit -m "rebrand: update CLAUDE.md and AGENTS.md to PM-Relay"
```

---

## Task 4: Update `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Change the `name` field**

Find:
```json
  "name": "basecamp-clone",
```
Replace with:
```json
  "name": "pm-relay",
  "description": "An open source project management workspace with an MCP server for AI connectivity.",
```

(Adds the `description` field immediately after `name`.)

- [ ] **Step 2: Verify no stragglers in package.json**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' package.json
```
Expected: no output.

Note: the `migrate:active`, `backfill:bc2-file-linkage`, and `db:reset-bc2-data` script entries MUST remain untouched — they reference BC2 as the import source.

- [ ] **Step 3: Run install to regenerate package-lock.json**

Run:
```sh
npm install
```

Expected: `package-lock.json` updates with new `"name": "pm-relay"` at top level.

- [ ] **Step 4: Commit**

```sh
git add package.json package-lock.json
git commit -m "rebrand: rename package to pm-relay and add description"
```

---

## Task 5: Update `lib/site-branding.ts`

**Files:**
- Modify: `lib/site-branding.ts`

- [ ] **Step 1: Update `DEFAULT_SITE_TITLE`**

Find:
```ts
export const DEFAULT_SITE_TITLE = "Project Manager";
```
Replace with:
```ts
export const DEFAULT_SITE_TITLE = "PM-Relay";
```

- [ ] **Step 2: Update `SITE_DESCRIPTION`**

Find:
```ts
export const SITE_DESCRIPTION = "Basecamp 2 replacement with Supabase + Dropbox";
```
Replace with:
```ts
export const SITE_DESCRIPTION = "An open source project management workspace with an MCP server for AI connectivity.";
```

- [ ] **Step 3: Verify no stragglers**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone|Basecamp 2' lib/site-branding.ts
```
Expected: no output.

- [ ] **Step 4: TypeCheck**

Run:
```sh
npx tsc --noEmit
```
Expected: no errors (this file is just constants, so nothing should break).

- [ ] **Step 5: Commit**

```sh
git add lib/site-branding.ts
git commit -m "rebrand: update default site title and description to PM-Relay"
```

---

## Task 6: Create `lib/theme-storage.ts` helper with failing test (TDD — red)

**Purpose:** The theme localStorage key is changing from `"basecamp-clone-theme"` to `"pm-relay-theme"`. To avoid wiping existing users' theme preferences, we read the new key first and fall back to the legacy key. Extracting this into a pure helper makes it unit-testable and reusable between `app/header.tsx` and the inline script in `app/layout.tsx`.

**Files:**
- Create: `lib/theme-storage.ts`
- Create: `tests/unit/theme-storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/theme-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readStoredTheme, THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY } from "@/lib/theme-storage";

function makeStorage(entries: Record<string, string>) {
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
    }
  };
}

describe("readStoredTheme", () => {
  it("returns null when no theme is stored under either key", () => {
    expect(readStoredTheme(makeStorage({}))).toBeNull();
  });

  it("reads the new key when present", () => {
    expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
  });

  it("falls back to the legacy key when the new key is absent", () => {
    expect(readStoredTheme(makeStorage({ [LEGACY_THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readStoredTheme(makeStorage({ [LEGACY_THEME_STORAGE_KEY]: "light" }))).toBe("light");
  });

  it("prefers the new key when both keys are present", () => {
    expect(
      readStoredTheme(
        makeStorage({ [THEME_STORAGE_KEY]: "light", [LEGACY_THEME_STORAGE_KEY]: "dark" })
      )
    ).toBe("light");
  });

  it("ignores invalid theme values from either key", () => {
    expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: "cyan" }))).toBeNull();
    expect(readStoredTheme(makeStorage({ [LEGACY_THEME_STORAGE_KEY]: "" }))).toBeNull();
  });

  it("exposes the expected storage key constants", () => {
    expect(THEME_STORAGE_KEY).toBe("pm-relay-theme");
    expect(LEGACY_THEME_STORAGE_KEY).toBe("basecamp-clone-theme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```sh
npx vitest run tests/unit/theme-storage.test.ts
```
Expected: FAIL — module `@/lib/theme-storage` does not exist.

- [ ] **Step 3: Create `lib/theme-storage.ts` with minimal implementation**

Create `lib/theme-storage.ts`:

```ts
export const THEME_STORAGE_KEY = "pm-relay-theme";
export const LEGACY_THEME_STORAGE_KEY = "basecamp-clone-theme";

export type StoredTheme = "light" | "dark";

type ReadableStorage = Pick<Storage, "getItem">;

function coerceTheme(value: string | null): StoredTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function readStoredTheme(storage: ReadableStorage): StoredTheme | null {
  const current = coerceTheme(storage.getItem(THEME_STORAGE_KEY));
  if (current) return current;
  return coerceTheme(storage.getItem(LEGACY_THEME_STORAGE_KEY));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```sh
npx vitest run tests/unit/theme-storage.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: TypeCheck**

Run:
```sh
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```sh
git add lib/theme-storage.ts tests/unit/theme-storage.test.ts
git commit -m "feat: add theme-storage helper with legacy key fallback"
```

---

## Task 7: Wire theme helper into `app/header.tsx`

**Files:**
- Modify: `app/header.tsx:11` and the `useEffect` that reads the theme around lines 68–78

- [ ] **Step 1a: Add the theme-storage import alongside the existing imports**

Find (at the top of the file, around line 9):
```ts
import { DEFAULT_SITE_LOGO_URL, DEFAULT_SITE_TITLE, normalizeSiteLogoUrl, normalizeSiteTitle } from "@/lib/site-branding";
```
Replace with:
```ts
import { DEFAULT_SITE_LOGO_URL, DEFAULT_SITE_TITLE, normalizeSiteLogoUrl, normalizeSiteTitle } from "@/lib/site-branding";
import { readStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme-storage";
```

- [ ] **Step 1b: Delete the legacy `THEME_KEY` constant (line 11)**

Find:
```ts
const THEME_KEY = "basecamp-clone-theme";
```
Delete this entire line. The `THEME_STORAGE_KEY` import from Step 1a replaces it.

- [ ] **Step 2: Update the theme-read `useEffect` (around lines 68–78)**

Find:
```ts
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      applyTheme(saved);
      return;
    }
    const systemTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(systemTheme);
    applyTheme(systemTheme);
  }, []);
```
Replace with:
```ts
  useEffect(() => {
    const saved = readStoredTheme(window.localStorage);
    if (saved) {
      setTheme(saved);
      applyTheme(saved);
      return;
    }
    const systemTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(systemTheme);
    applyTheme(systemTheme);
  }, []);
```

- [ ] **Step 3: Update the `toggleTheme` write (around line 201)**

Find:
```ts
  function toggleTheme() {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  }
```
Replace with:
```ts
  function toggleTheme() {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }
```

- [ ] **Step 4: Verify no stragglers in header.tsx**

Run:
```sh
rg 'basecamp-clone|THEME_KEY\b' app/header.tsx
```
Expected: no output.

- [ ] **Step 5: TypeCheck**

Run:
```sh
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Run the existing test suite to catch regressions**

Run:
```sh
npx vitest run tests/unit/theme-storage.test.ts
```
Expected: PASS (the helper contract is unchanged — this is a smoke check).

- [ ] **Step 7: Commit**

```sh
git add app/header.tsx
git commit -m "rebrand: use theme-storage helper in SiteHeader"
```

---

## Task 8: Update the inline theme init script in `app/layout.tsx`

**Why this file can't import the helper:** `app/layout.tsx` contains an inline `<Script strategy="beforeInteractive">` block that runs as raw JS in the browser before React hydration. It can't import from `@/lib/theme-storage`. Inline a minimal equivalent of the fallback logic.

**Files:**
- Modify: `app/layout.tsx:40-55` (the theme-init `<Script>` block)

- [ ] **Step 1: Replace the inline theme init script**

Find:
```tsx
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
            try {
              const key = "basecamp-clone-theme";
              const saved = window.localStorage.getItem(key);
              const theme =
                saved === "light" || saved === "dark"
                  ? saved
                  : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
              const root = document.documentElement;
              root.dataset.theme = theme;
              root.classList.remove("light", "dark");
              root.classList.add(theme);
            } catch {}
          })();`}
        </Script>
```
Replace with:
```tsx
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
            try {
              const read = (k) => {
                const v = window.localStorage.getItem(k);
                return v === "light" || v === "dark" ? v : null;
              };
              const saved = read("pm-relay-theme") || read("basecamp-clone-theme");
              const theme =
                saved ||
                (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
              const root = document.documentElement;
              root.dataset.theme = theme;
              root.classList.remove("light", "dark");
              root.classList.add(theme);
            } catch {}
          })();`}
        </Script>
```

- [ ] **Step 2: Verify no stragglers in layout.tsx**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' app/layout.tsx
```
Expected: no output.

- [ ] **Step 3: TypeCheck**

Run:
```sh
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Dev-server smoke sanity (optional, skip if no running dev)**

If a dev server is easy to start, run `npm run dev`, open the app, open DevTools → Application → Local Storage, and verify the theme still applies correctly after setting either `pm-relay-theme` or `basecamp-clone-theme` to `"dark"`. If a dev server is not readily runnable, skip and rely on the helper unit tests from Task 6.

- [ ] **Step 5: Commit**

```sh
git add app/layout.tsx
git commit -m "rebrand: inline theme-init script reads pm-relay-theme with legacy fallback"
```

---

## Task 9: Rename Supabase Edge Function directory and update file contents

**Why one task:** The directory rename and the content updates are atomically coupled — the function deploys as a unit, and mid-state would leave inconsistent log prefixes and JWT defaults. Keep them in one commit.

**Files:**
- Rename: `supabase/functions/basecamp-mcp/` → `supabase/functions/pm-relay-mcp/`
- Modify (after rename):
  - `supabase/functions/pm-relay-mcp/index.ts`
  - `supabase/functions/pm-relay-mcp/tools.ts`
  - `supabase/functions/pm-relay-mcp/db.ts`
  - `supabase/functions/pm-relay-mcp/notify.ts`

- [ ] **Step 1: Rename the directory via git mv**

Run:
```sh
git mv supabase/functions/basecamp-mcp supabase/functions/pm-relay-mcp
```

- [ ] **Step 2: Update file-header comments in all four files**

In each of `index.ts`, `tools.ts`, `db.ts`, `notify.ts`:

Find: `// supabase/functions/basecamp-mcp/`
Replace with: `// supabase/functions/pm-relay-mcp/`

(Line 1 of each file.)

- [ ] **Step 3: Update JWT issuer default in `index.ts:15`**

Find:
```ts
const JWT_ISSUER = Deno.env.get("PM_SERVER_JWT_ISSUER") ?? "basecamp-mcp";
```
Replace with:
```ts
const JWT_ISSUER = Deno.env.get("PM_SERVER_JWT_ISSUER") ?? "pm-relay-mcp";
```

- [ ] **Step 4: Update JWT audience default in `index.ts:16`**

Find:
```ts
const JWT_AUDIENCE = Deno.env.get("PM_SERVER_JWT_AUDIENCE") ?? "basecamp-mcp";
```
Replace with:
```ts
const JWT_AUDIENCE = Deno.env.get("PM_SERVER_JWT_AUDIENCE") ?? "pm-relay-mcp";
```

- [ ] **Step 5: Update MCP server name in `index.ts:87`**

Find:
```ts
    const server = new McpServer({ name: "basecamp-mcp", version: "2.0.0" });
```
Replace with:
```ts
    const server = new McpServer({ name: "pm-relay-mcp", version: "2.0.0" });
```

- [ ] **Step 6: Update log prefix in `index.ts:96`**

Find:
```ts
    console.error("basecamp-mcp request handling failed", {
```
Replace with:
```ts
    console.error("pm-relay-mcp request handling failed", {
```

- [ ] **Step 7: Verify no stragglers in the renamed directory**

Run:
```sh
rg 'basecamp-mcp|basecamp-clone' supabase/functions/pm-relay-mcp/
```
Expected: no output.

Note: the directory may still contain prose referring to "Basecamp 2" in comments that describe BC2 import/notification flows — those are source-system references and must remain.

- [ ] **Step 8: Verify nothing else in the repo imports from the old path**

Run:
```sh
rg 'functions/basecamp-mcp' \
  --glob '!docs/_archive/**' \
  --glob '!docs/superpowers/plans/closed/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/handoffs/**' \
  --glob '!docs/superpowers/plans/2026-04-09-mcp-file-upload.md' \
  --glob '!docs/superpowers/plans/2026-04-10-email-notifications-fix.md' \
  --glob '!docs/superpowers/plans/2026-04-10-rebranding-pm-relay.md'
```
Expected: matches only in `README.md` (handled in Task 12) and `supabase/config.toml` (handled in Task 10).

- [ ] **Step 9: Commit**

```sh
git add supabase/functions/
git commit -m "rebrand: rename Supabase Edge Function basecamp-mcp -> pm-relay-mcp"
```

---

## Task 10: Update `supabase/config.toml`

**Files:**
- Modify: `supabase/config.toml`

- [ ] **Step 1: Replace the function section header**

Find:
```toml
[functions.basecamp-mcp]
verify_jwt = false
```
Replace with:
```toml
[functions.pm-relay-mcp]
verify_jwt = false
```

- [ ] **Step 2: Verify no stragglers**

Run:
```sh
rg 'basecamp-mcp|basecamp-clone' supabase/config.toml
```
Expected: no output.

- [ ] **Step 3: Commit**

```sh
git add supabase/config.toml
git commit -m "rebrand: point supabase config to pm-relay-mcp function"
```

---

## Task 11: Rewrite `README.md`

**Files:**
- Modify: `README.md`

The README needs targeted edits to rebrand the product while preserving BC2 import documentation and API-path references to `/admin/imports/basecamp2` (the source-system endpoint).

- [ ] **Step 1: Update the title (line 1)**

Find:
```md
# Basecamp Clone v1
```
Replace with:
```md
# PM-Relay

> Project management, wired for AI.

An open source project management workspace with an MCP server for AI connectivity.
```

- [ ] **Step 2: Delete the stale `PLAN.md` sentence (line 3)**

Find:
```md
Next.js + Supabase + Dropbox implementation based on `PLAN.md`.
```
Delete this line entirely (the intro block from Step 1 already covers what the project is, and `PLAN.md` no longer exists in the active tree).

- [ ] **Step 3: Update the MCP section header and prose**

Find:
```md
## AI Agent MCP Setup

This project ships its own MCP server as a Supabase Edge Function at `supabase/functions/basecamp-mcp/`. Any AI agent harness (Claude Code, Cursor, Codex, etc.) can connect to it over HTTP using the Streamable HTTP transport.
```
Replace with:
```md
## AI Agent MCP Setup

This project ships its own MCP server as a Supabase Edge Function at `supabase/functions/pm-relay-mcp/`. Any AI agent harness (Claude Code, Cursor, Codex, etc.) can connect to it over HTTP using the Streamable HTTP transport.
```

- [ ] **Step 4: Update the connection-details URL row**

Find:
```md
| **URL** | `<SUPABASE_URL>/functions/v1/basecamp-mcp` (e.g. `https://YOUR-PROJECT.supabase.co/functions/v1/basecamp-mcp`) |
```
Replace with:
```md
| **URL** | `<SUPABASE_URL>/functions/v1/pm-relay-mcp` (e.g. `https://YOUR-PROJECT.supabase.co/functions/v1/pm-relay-mcp`) |
```

- [ ] **Step 5: Update the JWT mint example**

Find:
```md
```sh
node scripts/mint-mcp-jwt.mjs \
  --secret "$PM_CLIENT_JWT_SECRET" \
  --client-id "$PM_CLIENT_ID" \
  --issuer basecamp-mcp \
  --audience basecamp-mcp \
  --expires-in 900
```
```
Replace with:
```md
```sh
node scripts/mint-mcp-jwt.mjs \
  --secret "$PM_CLIENT_JWT_SECRET" \
  --client-id "$PM_CLIENT_ID" \
  --issuer pm-relay-mcp \
  --audience pm-relay-mcp \
  --expires-in 900
```
```

- [ ] **Step 6: Update the Claude Code quick-start example**

Find:
```md
# 2. Register the MCP server
claude mcp add --transport http \
  --header "Authorization: Bearer $TOKEN" \
  basecamp "$PM_CLIENT_MCP_URL"

# 3. Verify
claude mcp get basecamp
```
Replace with:
```md
# 2. Register the MCP server
claude mcp add --transport http \
  --header "Authorization: Bearer $TOKEN" \
  pm-relay "$PM_CLIENT_MCP_URL"

# 3. Verify
claude mcp get pm-relay
```

- [ ] **Step 7: Verify no product-name stragglers remain**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone|basecamp-mcp' README.md
```
Expected: no output.

Note: the line `POST /admin/imports/basecamp2` MUST remain (source-system endpoint). "Basecamp 2 import" prose in the features list describes the import source and stays. Run a sanity grep to confirm those are still present:
```sh
rg 'basecamp2|Basecamp 2' README.md
```
Expected: at least `POST /admin/imports/basecamp2` and any feature-bullet reference to Basecamp 2 imports.

- [ ] **Step 8: Commit**

```sh
git add README.md
git commit -m "rebrand: rewrite README for PM-Relay"
```

---

## Task 12: Check and clean up `plan.md` at repo root

**Files:**
- Inspect: `plan.md`

- [ ] **Step 1: Read the file**

Run:
```sh
cat plan.md
```

- [ ] **Step 2: Decide disposition**

- If the file is obviously stale scratch output from an old migration task (per the spec note: "migration plan output only"), delete it:
  ```sh
  git rm plan.md
  git commit -m "chore: remove stale top-level plan.md"
  ```
- If the file has content worth keeping, update the single `basecamp-clone/plan.md` path reference on line 66:

  Find: `basecamp-clone/plan.md`
  Replace with: `pm-relay/plan.md`

  Then:
  ```sh
  git add plan.md
  git commit -m "rebrand: update plan.md path reference to pm-relay"
  ```

- [ ] **Step 3: Verify it no longer contains product-name references**

Run:
```sh
rg 'basecamp-clone|Basecamp Clone' plan.md 2>/dev/null || echo "plan.md removed or clean"
```
Expected: `"plan.md removed or clean"` or no output.

---

## Task 13: Final grep verification

**Purpose:** Prove the repo is clean of product-name references (outside historical docs) and that BC2 source-system references are untouched.

- [ ] **Step 1: Product-name reference scan**

Run:
```sh
rg -l '(basecamp-clone|Basecamp Clone|basecamp-mcp)' \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!.next' \
  --glob '!package-lock.json' \
  --glob '!.claude/worktrees/**' \
  --glob '!docs/_archive/**' \
  --glob '!docs/superpowers/plans/closed/**' \
  --glob '!docs/superpowers/handoffs/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/plans/2026-04-09-mcp-file-upload.md' \
  --glob '!docs/superpowers/plans/2026-04-10-email-notifications-fix.md' \
  --glob '!docs/superpowers/plans/2026-04-10-rebranding-pm-relay.md'
```

Expected: **no output.** If there are matches, investigate and fix in a follow-up task before proceeding.

- [ ] **Step 2: BC2 snapshot comparison**

Run:
```sh
rg -l '\b(bc2|basecamp2)\b' \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!.next' \
  --glob '!package-lock.json' \
  --glob '!.claude/worktrees/**' \
  --glob '!docs/_archive/**' \
  | sort > /tmp/pm-relay-bc2-snapshot-after.txt
diff /tmp/pm-relay-bc2-snapshot.txt /tmp/pm-relay-bc2-snapshot-after.txt
```

Expected: **empty diff output.** If the diff is non-empty, BC2 code was inadvertently touched — investigate immediately and revert the offending change before continuing.

- [ ] **Step 3: Historical docs integrity check**

Run:
```sh
git status docs/superpowers/plans/closed/ docs/_archive/ docs/superpowers/handoffs/
```

Expected: "nothing to commit, working tree clean" (no modifications staged or unstaged in those directories across the full rebrand).

Also run:
```sh
git log --oneline --name-only $(git merge-base HEAD main)..HEAD -- docs/superpowers/plans/closed/ docs/_archive/ docs/superpowers/handoffs/
```

Expected: no files listed under these paths in any commit from this rebrand.

---

## Task 14: Build and test verification

**Purpose:** Confirm the rebranded codebase type-checks, builds, and passes all tests.

- [ ] **Step 1: TypeCheck**

Run:
```sh
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Lint**

Run:
```sh
npm run lint
```
Expected: passes (or reports only pre-existing warnings unrelated to the rebrand).

- [ ] **Step 3: Run the full test suite**

Run:
```sh
npm run test
```
Expected: all tests pass, including the new `tests/unit/theme-storage.test.ts`.

- [ ] **Step 4: Build**

Run:
```sh
npm run build
```
Expected: build succeeds. Watch for any remaining `basecamp-clone` references in build output (there should be none).

- [ ] **Step 5: No commit needed**

If any step above fails, stop and fix the root cause. Do NOT create a "fix the verification" commit that masks a rebrand regression — fix the offending earlier commit or add a proper follow-up commit with a clear reason.

---

## Task 15: Handoff notes for GitHub repo rename

**Purpose:** Capture the out-of-code actions the user must take to finish the rebrand.

- [ ] **Step 1: Write a short handoff note**

Create `docs/superpowers/handoffs/2026-04-10-pm-relay-rebrand.md`:

```md
# PM-Relay Rebrand — Handoff

**Date:** 2026-04-10
**Plan:** `docs/superpowers/plans/2026-04-10-rebranding-pm-relay.md`

## Completed in-repo
- Package, branding constants, README, CLAUDE.md/AGENTS.md, cursor rules, and agents doc renamed.
- Theme localStorage migrated to `pm-relay-theme` with legacy fallback.
- Supabase Edge Function renamed `basecamp-mcp` → `pm-relay-mcp` (directory, config.toml, JWT defaults, server name, log prefix).
- Build and tests verified.

## Manual actions required
1. **GitHub rename:** rename the repository from `basecamp-clone` to `pm-relay`.
   GitHub automatically redirects the old URL, but update any external clones, bookmarks, or CI references.
2. **Supabase function redeploy:** deploy the new `pm-relay-mcp` function. The old `basecamp-mcp` function still exists until explicitly deleted. If any live clients still hold JWTs issued under `iss/aud = basecamp-mcp`, set `PM_SERVER_JWT_ISSUER=basecamp-mcp` and `PM_SERVER_JWT_AUDIENCE=basecamp-mcp` as env vars on the new function during the transition, then clear them after all clients are reminted.
3. **Client MCP config:** update `PM_CLIENT_MCP_URL` in any environment/client config to point at `/functions/v1/pm-relay-mcp` and re-run `claude mcp add ... pm-relay "$PM_CLIENT_MCP_URL"`.
4. **Delete the old function:** once clients are verified on the new endpoint, delete `basecamp-mcp` from the Supabase project.
5. **Parent-dir CLAUDE.md (optional):** the copy at `../CLAUDE.md` (outside the git repo) was intentionally not touched by the rebrand commits. Update it by hand if desired.

## Out of scope (not done)
- Logo redesign (`/gx-logo.webp` unchanged).
- Domain / deployment URL changes.
- Supabase project rename.
- Dropbox folder structure changes.
- Historical plan/spec/archive rewrites (intentionally preserved).
```

- [ ] **Step 2: Commit**

```sh
git add docs/superpowers/handoffs/2026-04-10-pm-relay-rebrand.md
git commit -m "docs: add PM-Relay rebrand handoff notes"
```

---

## Done

At this point the repo is fully rebranded to PM-Relay, BC2 import code is provably untouched, historical docs are untouched, tests pass, and the handoff note captures the remaining out-of-code actions.
