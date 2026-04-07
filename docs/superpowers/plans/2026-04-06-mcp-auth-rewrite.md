# MCP Auth Rewrite — Implementation Plan

> **For agentic workers:** Use task-by-task execution with a single small task per subagent. Do not combine steps unless explicitly approved. This plan is intentionally structured for discovery → build → verify → review.

**Goal:** Replace the current MCP auth contract (`Authorization: Bearer <secret>` + `x-mcp-client-id`) with a signed short-lived JWT bearer token (`Authorization: Bearer <jwt>`), while keeping `agent_clients` as the canonical DB registry for enable/disable, role, and future revocation.

**Architecture:**
- MCP auth becomes JWT-based and self-identifying via `sub = agent_clients.client_id`.
- The edge function verifies signature, issuer, audience, and expiry before DB lookup.
- `agent_clients` remains the source of truth for whether an agent is enabled and what role it has.
- No use of Supabase human-user JWTs for the MCP boundary.

**Planned contract:**
- `Authorization: Bearer <jwt>` only
- Required claims: `sub`, `iss`, `aud`, `iat`, `exp`, `jti`
- Optional claims: `role`, `scope`, `token_version` / `auth_epoch`
- JWT subject maps to `agent_clients.client_id`
- Short token lifetime (recommended: 5–15 minutes)

**Tech Stack:** Deno edge runtime, `@modelcontextprotocol/sdk`, Supabase edge function, `jsonwebtoken`-style signing/verification approach as selected by the implementation task, Vitest, existing Supabase tables (`agent_clients`, `agent_profiles`)

**Related spec:** `docs/superpowers/specs/2026-03-26-supabase-mcp-server-design.md`

---

## File map

| File | Role |
|------|------|
| `supabase/functions/basecamp-mcp/auth.ts` | JWT verification, identity resolution, optional revocation checks |
| `supabase/functions/basecamp-mcp/index.ts` | Wire JWT auth into request handling |
| `supabase/migrations/0011_mcp_agents.sql` or follow-up migration | Add token version / auth epoch if revocation model requires it |
| `tests/unit/mcp-auth.test.ts` | Auth unit coverage |
| `tests/integration/mcp-smoke.test.ts` | Live smoke coverage using JWT bearer auth |
| `docs/superpowers/specs/2026-03-26-supabase-mcp-server-design.md` | Update spec if contract changes materially |
| `docs/superpowers/plans/2026-04-06-mcp-auth-rewrite.md` | This plan |

---

## Task 1: Discovery — map current MCP auth surface

**Best subagent:** discovery

**Goal:** identify every place the current auth contract is assumed.

**Inspect:**
- `supabase/functions/basecamp-mcp/index.ts`
- `supabase/functions/basecamp-mcp/auth.ts`
- `tests/unit/mcp-auth.test.ts`
- `tests/integration/mcp-smoke.test.ts`
- `tests/unit/mcp-config.test.ts`
- `docs/superpowers/specs/2026-03-26-supabase-mcp-server-design.md`

**Deliverable:**
- current auth headers and trust boundaries
- all files that must change for JWT auth
- compatibility or deployment risks

- [ ] Confirm current request contract and assumptions
- [ ] List all impacted files and tests
- [ ] Identify any deployment/compatibility concerns

---

## Task 2: Discovery — lock JWT contract and revocation model

**Best subagent:** discovery

**Goal:** make the JWT shape and validation rules exact enough to implement.

**Decide:**
- JWT algorithm: `HS256` vs `RS256`/`EdDSA`
- required claims
- optional claims
- issuer and audience
- token lifetime
- revocation strategy: short-lived only vs `token_version` vs `auth_epoch`

**Deliverable:**
- short auth contract spec with exact claims and validation rules
- recommendation on signing and revocation approach

- [ ] Choose signing strategy
- [ ] Define required/optional claims
- [ ] Recommend revocation model
- [ ] Record final token contract

---

## Task 3: Build — implement JWT verification in MCP auth

**Best subagent:** build

**Goal:** replace the raw secret validation path with JWT verification.

**Scope:**
- parse `Authorization: Bearer <jwt>`
- verify signature
- verify `iss`, `aud`, `exp`
- extract `sub` as `client_id`
- load `agent_clients` row for that client
- reject missing/invalid/expired tokens
- preserve `disabled` check and role resolution

**Deliverable:**
- JWT auth path that returns `AgentIdentity`

- [ ] Implement JWT parsing and verification
- [ ] Resolve identity from `sub`
- [ ] Keep DB-backed enabled/role checks
- [ ] Reject invalid or expired tokens

---

## Task 4: Build — remove `x-mcp-client-id` from auth contract

**Best subagent:** build

**Goal:** make the JWT the only identity-bearing input.

**Scope:**
- eliminate request-time dependence on `x-mcp-client-id`
- ensure the server trusts only JWT `sub`
- keep DB-backed agent lookup and disabled checks

**Deliverable:**
- single-header auth contract: `Authorization: Bearer <jwt>`

- [ ] Remove header-based identity dependency
- [ ] Ensure no request path requires `x-mcp-client-id`
- [ ] Keep identity mapping intact through JWT `sub`

---

## Task 5: Build — add token issuance / minting path

**Best subagent:** build

**Goal:** provide one concrete way to mint valid agent JWTs.

**Possible implementations:**
- admin script
- edge/admin endpoint
- local CLI helper

**Scope:**
- mint JWT with correct claims
- sign using chosen key strategy
- short expiry
- optional token version / auth epoch support

**Deliverable:**
- one working JWT minting path for MCP clients

- [ ] Implement minting approach
- [ ] Ensure issued tokens match the contract
- [ ] Keep issuance separate from request verification

---

## Task 6: Build — update smoke/config examples

**Best subagent:** build

**Goal:** align examples and smoke checks with the JWT contract.

**Likely files:**
- `tests/integration/mcp-smoke.test.ts`
- docs or config examples referencing MCP auth headers
- any wrapper or local extension config if relevant

**Scope:**
- remove `x-mcp-client-id` from examples
- update bearer token expectations to JWT
- adjust environment variable names if needed

**Deliverable:**
- smoke/test/config examples that use JWT bearer auth only

- [ ] Update smoke test auth headers
- [ ] Update config/examples
- [ ] Remove obsolete identity header usage from docs/tests

---

## Task 7: Verify — unit tests for JWT auth behavior

**Best subagent:** verify

**Goal:** prove the new auth contract and failure modes.

**Likely files:**
- `tests/unit/mcp-auth.test.ts`
- optional new JWT-focused test file if cleaner

**Test cases:**
- missing token → 401
- malformed JWT → 401
- invalid signature → 401
- expired token → 401
- wrong issuer/audience → 401
- disabled agent → 401
- valid token → resolves identity

**Deliverable:**
- passing unit coverage for JWT auth

- [ ] Add failure-path coverage
- [ ] Add valid-token coverage
- [ ] Confirm DB lookup and disabled check behavior

---

## Task 8: Verify — integration smoke coverage for JWT auth

**Best subagent:** verify

**Goal:** prove the MCP endpoint works end-to-end with JWT bearer auth.

**Likely files:**
- `tests/integration/mcp-smoke.test.ts`

**Test cases:**
- `tools/list` succeeds with JWT bearer token
- invalid JWT rejected
- no `x-mcp-client-id` required

**Deliverable:**
- smoke test that exercises the new auth path end-to-end

- [ ] Update live smoke auth usage
- [ ] Confirm success path with JWT only
- [ ] Confirm auth rejection behavior

---

## Task 9: Review — security review of the auth boundary

**Best subagent:** review

**Goal:** catch trust-boundary issues before implementation is accepted.

**Check:**
- no reuse of Supabase human auth JWTs
- no trust in extra headers
- signature verification is mandatory
- expiry is short enough
- revocation story is adequate
- errors don’t leak secrets or internal state

**Deliverable:**
- security review note with findings and hardening suggestions

- [ ] Review token trust boundary
- [ ] Review revocation and expiry
- [ ] Review error handling and leakage risk

---

## Task 10: Review — contract review against spec and docs

**Best subagent:** review

**Goal:** ensure the implementation plan matches the project’s MCP architecture and documentation.

**Check:**
- token claims match the agreed contract
- `agent_clients` remains canonical for agent status/role
- `x-mcp-client-id` is removed from the contract
- docs/config examples align with the implementation direction
- no accidental coupling to human app auth

**Deliverable:**
- go/no-go contract review

- [ ] Verify contract consistency
- [ ] Verify docs/spec consistency
- [ ] Confirm implementation boundaries

---

## Recommended execution order

1. Discovery team: Task 1, Task 2
2. Build team: Task 3, Task 4, Task 5, Task 6
3. Verify team: Task 7, Task 8
4. Review team: Task 9, Task 10

---

## Recommended first-pass scope

Keep the first implementation pass minimal:
- JWT bearer only
- `sub = client_id`
- `iss`, `aud`, `exp`, `iat`
- DB check for `agent_clients.disabled`
- no `x-mcp-client-id`
- no compatibility shim

This gives a clean auth boundary immediately, with room to add stronger revocation later if needed.
