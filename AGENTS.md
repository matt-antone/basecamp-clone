# Basecamp Clone Project Guide

This repository inherits the user-level and system-level agent instructions already configured for Codex. This file adds project-specific guidance for work inside this repo.

## RFC 2119 Interpretation

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and `OPTIONAL` in this document are to be interpreted as described in RFC 2119.

You are an orchestrator for this project. You SHOULD orchestrate sub-agents.

## Required Startup Step

- Agents working in this repository MUST invoke `/context-mode` before substantial exploration, analysis, or implementation.
- If `/context-mode` has not been invoked yet for the current session, agents MUST invoke it before continuing.
- This `/context-mode` requirement is REQUIRED project procedure and is not optional.
- This requirement MUST be applied to all sub-agents spawned for work in this repository.
- Each sub-agent MUST invoke `/context-mode` before substantial exploration, analysis, or implementation, even if the parent agent already invoked it.
- If direct `/context-mode` invocation is unavailable in the current execution path, the agent MUST follow the repository's context-mode operating rules explicitly: prefer context-mode MCP tools over raw shell or file dumping, avoid blocked network patterns, and keep retrieved context minimal and query-driven.

See CONTEXT-MODE.md

## Required Memory Loop

- All agents and sub-agents working in this repository MUST use the `ai-memory` MCP loop whenever `mcp__ai-memory__*` tools are available.
- The memory loop is REQUIRED operating procedure for every task and is not optional guidance.
- Agents MUST use this exact repo namespace for repo-scoped memory operations: `{ repo_url: "https://github.com/matt-antone/basecamp-clone.git" }`.

### ai-memory loop

When `mcp__ai-memory__*` tools are available, use them as a persistent memory loop on every task:

- **Session start**: Agents MUST call `memory_list_recent` twice — once with `{ repo_url: "https://github.com/matt-antone/basecamp-clone.git" }`, once with no namespace. Global items (`repo_url: null`) are included in repo-scoped searches but NOT in repo-scoped `list_recent` calls.
- **Task start**: Agents MUST call `memory_search` with a relevant query to surface prior context specific to the task.
- **During work**: Agents MUST persist stable facts, decisions, discoveries, and bug workarounds with `memory_write`. Agents SHOULD skip transient progress chatter.
- **Task end**: Agents MUST write a concise outcome summary with `memory_write`. Agents SHOULD link related items with `memory_link`. Agents SHOULD use `memory_promote_summary` to distill detailed items into durable takeaways.
- **Post-task reflection**: After completing a task, agents SHOULD reflect on what they learned. If there are new patterns, gotchas, architectural decisions, or reusable insights, agents SHOULD save them with `memory_write`. Agents SHOULD skip obvious or already-documented things.
- **Long content**: Agents SHOULD use `memory_ingest_document` instead of many individual writes.

If `mcp__ai-memory__*` tools are unavailable, agents MUST say so briefly and continue the main task.

## Project Overview

- Stack: Next.js 15 App Router, React 19, TypeScript, Supabase, Dropbox, Nodemailer, Vitest.
- Purpose: a Basecamp-style client project workspace with projects, threads, comments, uploads, settings, and Basecamp 2 import support.
- Canonical project identity format: `CLIENTCODE-0001-Title`.
- File storage uses Dropbox project folders under `/projects/<client-slug>/<project-code>-<project-slug>/uploads`.
- Email delivery is best-effort: writes should still succeed when notifications fail.


## Working Rules

- Agents SHOULD preserve existing App Router patterns and be deliberate about server versus client components.
- Agents SHOULD extend existing helpers and repositories instead of introducing parallel abstractions.
- Agents SHOULD keep request validation explicit and SHOULD reuse existing schema and parsing patterns where possible.
- Agents MUST treat Supabase schema assumptions, Dropbox folder conventions, and project identity formatting as compatibility-sensitive.
- Agents MUST NOT edit `.env.local` or rotate secrets unless the user explicitly asks.
- Agents SHOULD preserve the existing product tone and interaction model unless the user asks for a visual redesign.

## Testing Expectations

- Agents SHOULD add or update tests whenever behavior changes in routes, storage, auth, imports, or formatting logic.
- Agents SHOULD prefer targeted Vitest runs during iteration and SHOULD run `npm run test` when the touched surface is broad enough to justify it.
- Agents SHOULD use `tests/unit` for isolated logic and `tests/integration` for cross-module behavior, and MUST treat `tests/e2e/user-flow.spec.ts` as incomplete placeholder coverage unless it is explicitly expanded.

## Change Hygiene

- Agents MUST call out schema changes, env var changes, or API contract changes clearly in the final handoff.
- Agents SHOULD avoid incidental refactors while touching auth, repository, import, or storage code.
- If agents discover duplicate or stale documentation, they SHOULD update it only when it directly affects the task or would otherwise mislead follow-up work.
