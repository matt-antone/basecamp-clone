# basecamp-clone: layer-ordered specialized agents

**Purpose:** Dispatch prompts for BC2 (and similar import) work in **dependency order by layer**. Each sub-agent owns one slice of the stack; the coordinator never edits code.

**Repo root:** `basecamp-clone/`  
**Memory namespace (ai-memory):** `https://github.com/matt-antone/basecamp-clone.git` (see root `AGENTS.md`).

---

## Coordinator

**Role:** Select the next checkbox from the active written plan. Paste **only** that task, acceptance criteria, and file paths into the sub-agent prompt. Do not implement.

**Constraints:** One dispatched worker at a time; workers must not spawn nested sub-agents.

---

## 1. Schema / migration agent

| | |
|--|--|
| **Paths** | `supabase/migrations/`; optional operator SQL under `scripts/` (e.g. reset/verify helpers). |
| **Charter** | Tables/columns/indexes for `import_map_*` and profile compatibility; RLS assumptions; avoid migration number collisions. |
| **Handoff** | Named migration file + apply/verify notes. |
| **Must not** | App routes, import TypeScript, or HTTP client code. |

---

## 2. BC2 HTTP client agent

| | |
|--|--|
| **Paths** | `lib/imports/bc2-client.ts`, `tests/unit/bc2-client.test.ts`. |
| **Charter** | Basic auth, `User-Agent`, pagination (`Link` / `next`), 429 backoff; tests with mocked `fetch`. |
| **Handoff** | Stable public API on `Bc2Client` for the fetcher. |
| **Must not** | Resource loops, transforms, or database I/O. |

---

## 3. Fetcher / async-generator agent

| | |
|--|--|
| **Paths** | `lib/imports/bc2-fetcher.ts` (and fetcher tests if split out). |
| **Charter** | Per-resource async generators; streaming/project-by-project consumption; use `Bc2Client` only; minimal shape handling. |
| **Handoff** | Generator entry points and resource ordering notes for the CLI/orchestrator. |
| **Must not** | Title/client parsing, people mapping, or `import_map_*` writes. |

---

## 4. Transform / mapping agent

| | |
|--|--|
| **Paths** | `lib/imports/bc2-transformer.ts`, `tests/unit/bc2-transformer.test.ts`. |
| **Charter** | Title parsing, client inference, people → profile mapping; pure functions + unit tests. |
| **Handoff** | Function signatures and DTO shapes expected by the orchestrator. |
| **Must not** | `fetch`, HTTP, or raw SQL. |

---

## 5. Orchestration / CLI agent

| | |
|--|--|
| **Paths** | `scripts/migrate-bc2.ts`; `lib/db.ts`, `lib/repositories.ts` only as needed for existing import job APIs. |
| **Charter** | Flags (dry / limited / full), `import_jobs` / `import_logs`, idempotent inserts via `import_map_*` and repos, SIGINT; no parallel import framework. |
| **Handoff** | Runnable CLI; env vars in `.env.example` when the plan requires it. |
| **Must not** | Redesign schema or the HTTP client. |

---

## 6. Auth / reconciliation agent

| | |
|--|--|
| **Paths** | `app/auth/callback/route.ts` (or the single canonical `createUserProfile` site used by the project). |
| **Charter** | Legacy `user_profiles.is_legacy`, email alignment with BC2-created rows; smallest change that satisfies the spec. |
| **Handoff** | Short note on first-login reconciliation behavior. |
| **Must not** | Migration SQL or BC2 client/fetcher code. |

---

## 7. Integration / idempotency agent

| | |
|--|--|
| **Paths** | `tests/integration/bc2-migrate.test.ts` (and related integration tests if added). |
| **Charter** | Smoke and idempotency against a real DB when `DATABASE_URL` is set; clear skip when unset. |
| **Handoff** | How to run locally and what regressions it catches. |
| **Must not** | Replace or weaken focused unit tests. |

---

## 8. Import infra guardian

| | |
|--|--| 
| **Paths** | `lib/repositories.ts` and existing `import_jobs` / `import_logs` / `import_map_*` usage across the import surface. |
| **Charter** | Extend existing import patterns only; catch duplicate or parallel abstractions in review. |
| **Handoff** | Checklist confirmation: uses existing tables/helpers. |
| **Must not** | Large refactors unrelated to the task. |

---

## Dispatch order

Run **1 → 7** in sequence unless the active plan explicitly documents a dependency exception. Layer **8** is advisory (coordinator or reviewer hat).

---

## Related plans and specs

- Import pipeline plan: `docs/superpowers/plans/2026-03-29-bc2-migration.md`
- Original design: `docs/superpowers/specs/2026-03-27-bc2-migration-design.md`

---

## Making agents actually follow this (Cursor / humans)

There is no hard guarantee for LLM behavior. Stack these to **bias** compliance:

| Lever | What it does |
|-------|----------------|
| **Project rule** | `.cursor/rules/import-layer-agents.mdc` — Cursor attaches it when import/migration paths match the session. |
| **Repo guide** | `AGENTS.md` / `CLAUDE.md` — Require following this doc for BC2/import work. |
| **Chat prompt** | `@docs/superpowers/agents/2026-03-31-basecamp-clone-layer-agents.md` (or the rule file) on **every** new thread that touches imports. |
| **Review** | Human or PR checklist: “one layer / matches roster Must not.” |

Expand the rule’s `globs` in `.cursor/rules/import-layer-agents.mdc` if you add new import entry points.
