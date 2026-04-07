# Implementation Plan

## Goal
Create subagent-management-ready equivalents of the discovery/build/verify/review team playbooks, with concrete agent definitions, non-Anthropic model guidance, and reusable chain templates.

## Tasks
1. **Extract canonical team contracts from existing playbooks**
   - File: `/Users/matthewantone/.pi/agent/teams/{discovery,build,verify,review}/AGENTS.md`
   - Changes: No edits; capture mission, orchestrator behaviors, worker mapping, and handoff schema as migration inputs.
   - Acceptance: A normalized mapping table exists for all 4 teams (mission, workers, expected output fields).

2. **Create 4 orchestrator-style subagents via management API**
   - File: `subagent API payloads (action: create/update)`
   - Changes: Define concrete agents:
     - `team-discovery-orchestrator`
     - `team-build-orchestrator`
     - `team-verify-orchestrator`
     - `team-review-orchestrator`
   - Acceptance: `subagent { action: "list" }` shows all 4; `action: "get"` confirms prompts and skills match playbook intent.

3. **Apply concrete prompts and skills per agent (playbook-faithful)**
   - File: `subagent API payloads (config.systemPrompt, config.skills)`
   - Changes: Use these prompt baselines:
     - `team-discovery-orchestrator` prompt core: “Gather reliable context before implementation. Define precise question, parallelize reads, summarize facts/unknowns/next team. Do not change code unless explicitly asked.”
       - Skills: `discovery-scout,discovery-doc-reader`
     - `team-build-orchestrator` prompt core: “Implement code changes cleanly/minimally. Break into ordered steps, parallelize safe independent edits, keep style consistency, request verification after implementation.”
       - Skills: `build-implementer,build-refactorer`
     - `team-verify-orchestrator` prompt core: “Prove behavior and catch regressions. Select smallest meaningful checks, prefer focused runs, parallelize independent checks, report pass/fail + risk gaps.”
       - Skills: `verify-tester,verify-runner`
     - `team-review-orchestrator` prompt core: “Evaluate correctness, safety, and polish. Split findings by correctness/security/maintainability/UX, consolidate into go/no-go recommendation.”
       - Skills: `review-code-reviewer,review-security-reviewer`
   - Acceptance: Each agent returns structured handoff matching original playbook sections.

4. **Set non-Anthropic model defaults and fallback strategy**
   - File: `subagent API payloads (config.model)`
   - Changes:
     - Preferred default (portable): set `model` to a non-Anthropic family (e.g., `google/gemini-3-pro`) for all 4 agents.
     - Optional cost split:
       - discovery/verify: lighter non-Anthropic profile
       - build/review: stronger non-Anthropic profile
     - Document fallback rule: if a configured model is unavailable, re-run `action:update` with another non-Anthropic model rather than Anthropic.
   - Acceptance: Agent configs resolve without Anthropic model IDs and execute successfully in a smoke delegation.

5. **Create optional chain(s) for common team routing**
   - File: `subagent API payloads (chain config)`
   - Changes: Add at least one reusable chain, optionally three:
     1. `chain-discovery-build`
        - Step 1: `team-discovery-orchestrator` — analyze task and produce scoped implementation context
        - Step 2: `team-build-orchestrator` — implement plan from previous output
     2. `chain-build-verify-review`
        - Step 1: build → Step 2: verify → Step 3: review
     3. `chain-full-delivery`
        - Step 1: discovery → Step 2: build → Step 3: verify → Step 4: review
   - Acceptance: `subagent { action: "list" }` shows created chains; dry-run or sample execution shows `{previous}` handoff continuity.

6. **Validate migration with minimal smoke tasks**
   - File: `runtime checks (no repo code edits)`
   - Changes: Run one tiny task per new agent and one tiny chain task; verify output format fidelity:
     - discovery: found/unknowns/next team
     - build: files changed/rationale/verification needs
     - verify: commands/results/failures
     - review: issues/severity/recommendation
   - Acceptance: All agents/chains produce expected schema-aligned outputs and can be used as drop-in “subagent-compatible surfaces” for existing team playbooks.

## Files to Modify
- `/Volumes/External/Glyphix Dropbox/Development Files/Under Development/Project Manager/basecamp-clone/plan.md` - migration plan output only.

## New Files (if any)
- None required. (Optional: add a reusable `docs/subagents/team-migration.md` runbook if you want persistent API payload examples.)

## Dependencies
- Task 1 → required before Tasks 2–5.
- Tasks 2 and 3 are tightly coupled (agent creation + prompt/skill mapping).
- Task 4 depends on Task 2 (models applied to created agents).
- Task 5 depends on Tasks 2–4 (chains reference created agents).
- Task 6 depends on Tasks 2–5.

## Risks
- **Model availability drift:** chosen non-Anthropic model IDs may differ by environment; mitigation: keep a tested fallback list and use `action:update` quickly.
- **Prompt drift from playbooks:** over-condensed prompts may lose handoff structure; mitigation: enforce explicit output schema text in each system prompt.
- **Name collisions:** agent/chain names may already exist; mitigation: use deterministic prefixes (e.g., `team-*`) and `action:update` when present.
- **Skill resolution mismatch:** if skill names are unavailable in the subagent runtime, outputs degrade; mitigation: verify installed skills first and adjust config accordingly.
