# Rebranding: basecamp-clone → PM-Relay

**Date:** 2026-04-10
**Status:** Approved

## Context

The project originated as a Basecamp 2 clone but has grown well beyond that starting point — adding financial rollup, client management, Dropbox file storage, Google Sheets integration, email notifications, and most distinctively, an MCP server for AI agent connectivity. The name "basecamp-clone" carries trademark risk and no longer reflects what the project is.

## Decision

**New name: PM-Relay**

"PM" anchors to project management. "Relay" reflects the project's standout feature: an MCP server that relays project context to AI agents.

## Brand Identity

| Field | Value |
|-------|-------|
| Name | PM-Relay |
| GitHub repo | `pm-relay` |
| `package.json` name | `pm-relay` |
| User-facing default site title | `PM-Relay` |
| Meta description | An open source project management workspace with an MCP server for AI connectivity. |
| Tagline | Project management, wired for AI. |

## CRITICAL: Two Distinct Uses of "basecamp" in the Codebase

The codebase contains two categorically different "basecamp" references. The implementation MUST treat them differently.

### 1. Product-name references — MUST be renamed
These refer to **our product** and are the entire point of this rebrand.
- `basecamp-clone` (repo name, package name)
- `"Basecamp Clone"` (README title, CLAUDE.md, AGENTS.md headings)
- `"Basecamp 2 replacement..."` (meta description in `lib/site-branding.ts`)

### 2. Source-system references — MUST NOT be renamed
These refer to **Basecamp 2, the third-party system we import data from**. Renaming them would destroy the BC2 import pipeline.
- `scripts/migrate-bc2.ts`
- `lib/imports/bc2-*.ts` files
- `POST /admin/imports/basecamp2` endpoint (and its route file)
- `supabase/migrations/*bc2*.sql`
- `tests/**/*bc2*.test.ts`
- `db:reset-bc2-data`, `backfill:bc2-file-linkage`, `migrate:active` scripts in `package.json`
- Any prose referring to "Basecamp 2" as the source system being imported

**Rule of thumb:** If it talks about the source of an import, keep it. If it names our product, rename it.

## Scope of Changes — Code & Config

### `package.json`
- `name`: `"basecamp-clone"` → `"pm-relay"`
- Add `description`: `"An open source project management workspace with an MCP server for AI connectivity."`
- **Do NOT** rename the `migrate:active`, `backfill:bc2-file-linkage`, or `db:reset-bc2-data` scripts — they refer to the BC2 import source.

### `package-lock.json`
- Regenerates automatically on next `npm install`. No manual edit needed.

### `lib/site-branding.ts`
- `DEFAULT_SITE_TITLE`: `"Project Manager"` → `"PM-Relay"`
- `SITE_DESCRIPTION`: `"Basecamp 2 replacement with Supabase + Dropbox"` → `"An open source project management workspace with an MCP server for AI connectivity."`
- `DEFAULT_SITE_LOGO_URL` stays as-is (`/gx-logo.webp`) — logo redesign is out of scope.

### `localStorage` theme key (two files)
- `app/header.tsx:11` — `const THEME_KEY = "basecamp-clone-theme"` → `"pm-relay-theme"`
- `app/layout.tsx:44` — hardcoded `"basecamp-clone-theme"` in the theme init `<Script>` block → `"pm-relay-theme"`
- **Migration strategy:** On first read, fall back to the legacy key if the new key is absent, then write under the new key. One-liner in both locations — avoids wiping the user's theme preference on upgrade.

### Supabase Edge Function rename
The MCP server lives at `supabase/functions/basecamp-mcp/` and is deployed to `/functions/v1/basecamp-mcp`. Rename it to `pm-relay-mcp`:
- `supabase/functions/basecamp-mcp/` → `supabase/functions/pm-relay-mcp/` (directory rename)
- File header comments: `// supabase/functions/basecamp-mcp/*.ts` → `// supabase/functions/pm-relay-mcp/*.ts` in `tools.ts`, `db.ts`, `notify.ts`, `index.ts`
- `supabase/config.toml`: `[functions.basecamp-mcp]` → `[functions.pm-relay-mcp]`
- `supabase/functions/.../index.ts:15-16` — JWT default issuer/audience: `"basecamp-mcp"` → `"pm-relay-mcp"` (these already honor the `PM_SERVER_JWT_ISSUER`/`PM_SERVER_JWT_AUDIENCE` env vars, so existing tokens can be kept alive by setting those env vars to `"basecamp-mcp"` during transition — see Deployment notes)
- `supabase/functions/.../index.ts:87` — `McpServer({ name: "basecamp-mcp", ... })` → `"pm-relay-mcp"`
- `supabase/functions/.../index.ts:96` — log message `"basecamp-mcp request handling failed"` → `"pm-relay-mcp request handling failed"`

### README.md
Full rewrite of:
- Title: `# Basecamp Clone v1` → `# PM-Relay`
- Introductory sentence (remove `PLAN.md` reference; that file no longer exists)
- Features list — replace any lingering "Basecamp clone" framing with the new identity
- "AI Agent MCP Setup" section — update URL path examples from `/functions/v1/basecamp-mcp` to `/functions/v1/pm-relay-mcp`, update `--issuer`/`--audience` examples, update `claude mcp add ... basecamp` example to `claude mcp add ... pm-relay`
- **Keep** the `POST /admin/imports/basecamp2` line in the API Paths list — that endpoint describes importing *from* Basecamp 2.

### `CLAUDE.md` and `AGENTS.md` (both copies — project root and repo root)
Both files contain identical project guide content. Update in both:
- Heading: `# Basecamp Clone Project Guide` → `# PM-Relay Project Guide`
- Line referencing `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md` — update the path after the agents doc is renamed (see below)
- `ai-memory` repo namespace (two occurrences each): `https://github.com/matt-antone/basecamp-clone.git` → `https://github.com/matt-antone/pm-relay.git`
- Any prose reference to "basecamp-clone" as the product name

### `.cursor/rules/import-layer-agents.mdc`
- Update the reference to `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md` after the agents doc is renamed.

### `docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md`
- Rename file: `2026-03-31-basecamp-clone-layer-agents.md` → `2026-03-31-pm-relay-layer-agents.md`
- Update file body: heading `# basecamp-clone: layer-ordered specialized agents` → `# PM-Relay: layer-ordered specialized agents`; `**Repo root:** basecamp-clone/` → `pm-relay/`; memory namespace URL; the `@docs/...` chat-prompt reference in the file.

### `plan.md` (repo root)
- Inspect and either update the one `basecamp-clone/plan.md` reference or delete the file if it's stale. Not a blocker.

## Scope of Changes — Historical Docs (DO NOT TOUCH)

The following files contain `basecamp-clone` references but are **frozen historical records** and must NOT be rewritten:
- `docs/superpowers/plans/closed/**`
- `docs/superpowers/specs/**` (except this file)
- `docs/_archive/**`
- `docs/superpowers/handoffs/**`

Rewriting historical plans and specs would falsify the project history. Leave them alone.

**Exception:** Active (not closed) plan files under `docs/superpowers/plans/` that still have work remaining — update path references only if they block ongoing work. Currently in-flight:
- `docs/superpowers/plans/2026-04-10-email-notifications-fix.md`
- `docs/superpowers/plans/2026-04-09-mcp-file-upload.md`

Leave these alone unless the user explicitly asks to update them.

## Scope of Changes — GitHub (manual)

- Rename repository: `basecamp-clone` → `pm-relay`
- Update repo description on GitHub to the new one-liner
- GitHub redirects from the old URL will continue to work automatically
- Any Vercel / deployment project names: out of scope unless the user asks

## Out of Scope

- Visual redesign (logo, color palette, UI chrome)
- Domain / deployment URL changes
- Supabase project rename
- Dropbox folder structure changes
- Rewriting historical plans, specs, handoffs, or archive docs
- Any renaming of BC2 import code, scripts, routes, migrations, or tests

## Deployment Notes

The Supabase Edge Function rename changes the deployed URL path from `/functions/v1/basecamp-mcp` to `/functions/v1/pm-relay-mcp`. To deploy without breaking existing agents mid-flight:

1. Deploy the new `pm-relay-mcp` function (the old `basecamp-mcp` function continues to exist until explicitly deleted).
2. Update `PM_CLIENT_MCP_URL` in any client configs to the new path.
3. If existing JWTs in the wild need to keep working, set `PM_SERVER_JWT_ISSUER=basecamp-mcp` and `PM_SERVER_JWT_AUDIENCE=basecamp-mcp` as env vars on the new function until all clients are reminted.
4. Delete the old `basecamp-mcp` function after verifying the new one is healthy.

For a portfolio/single-user deployment, the simpler path is: redeploy, update the one client config, mint a fresh JWT, done.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Destroying BC2 import code by over-eager renaming | Explicit "DO NOT rename" rule above, enforced in the implementation plan as a separate task |
| Breaking user's theme preference | Read legacy `basecamp-clone-theme` as fallback, write new key going forward |
| Breaking deployed MCP clients | Staged rollout per Deployment Notes; or for single-user, just redeploy and update the one client |
| Rewriting history in closed plans/specs | Explicit "frozen historical records" rule; implementation plan keeps a single `find`-like audit step to verify nothing in `docs/superpowers/plans/closed/` or `docs/_archive/` was touched |
| Missing a reference | Implementation plan includes a final grep pass for both `basecamp-clone` and `Basecamp Clone` in the non-historical tree |

## Verification Checklist (for implementation plan)

- [ ] `grep -r "basecamp-clone" .` returns only historical docs (plans/closed, _archive, handoffs, existing specs)
- [ ] `grep -r "Basecamp Clone" .` returns only historical docs
- [ ] `npm run build` succeeds
- [ ] `npm run test` succeeds
- [ ] `lib/site-branding.ts` exports `DEFAULT_SITE_TITLE = "PM-Relay"`
- [ ] BC2 import scripts, routes, migrations, and tests are untouched (`grep -l "bc2\|basecamp2" scripts/ lib/imports/ tests/ supabase/migrations/` matches same files as before)
- [ ] Supabase function rename complete; `supabase/config.toml` references `pm-relay-mcp`
- [ ] README and CLAUDE.md / AGENTS.md reflect PM-Relay identity
