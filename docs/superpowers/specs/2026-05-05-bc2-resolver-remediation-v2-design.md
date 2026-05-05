# BC2 Resolver Remediation v2 — Design

## Context

The first round of BC2 import remediation (`docs/superpowers/specs/2026-05-04-bc2-import-remediation-design.md`) introduced `lib/imports/bc2-client-resolver.ts` with normalized-prefix lookup, leading-word fallback, and auto-create-pending classification. An end-to-end `--mode=full --projects=all` run on the 3691-row corpus exposed two real-world gaps:

1. **Aggressive auto-create.** The leading-word fallback (`Step 4`) accepts any `[A-Za-z]+` token followed by a `-\d` marker as an auto-create candidate. On the full corpus this materialized clients named `Merrill` (3 projects), `Rainbow` (3), `S` (3), `Senior` (1) — all wrong. `Merrill` should be `Merrill Lynch`; `S` came from `S&S: ToDo`; `Rainbow` and `Senior` came from titles where the leading word was a coincidence, not a client code.
2. **Colon-variant titles unhandled.** Real BC2 data uses two colon shapes the resolver doesn't parse:
   - `EcoTech: 001-Energy Int'l Logo` — `code: num-title`
   - `Huntsman: Email Change`, `Shalom Institute: Infographic` — `code: title` (no num)

   Both fall through to `matchedBy: "none"` and become orphans. There were 4 such projects across the corpus (3 single-colon-num + ~2 single-colon-no-num).

## Goals

- Stop generating spurious single-character auto-create clients (kills `S`).
- Resolve colon-variant titles when they reference known clients or carry a clean `num` signal.
- Preserve all existing matched-by-code, matched-by-name, and orphan behavior unchanged.

## Non-Goals

- Codes with embedded digits (`R2LG-003: Training w/Matt`) — remain orphans.
- Parens prefix (`Levato (Summit LA) Logo & Stationery Package`) — remain orphans.
- Stop-list to filter common nouns from auto-create (`Senior`, `Rainbow`, `Merrill`) — explicitly accepted as a known limitation; user opted for the simpler ≥3-char gate over a stop-list. These will continue to auto-create on re-run.
- Manual triage UI for orphans — separate concern, separate spec.
- Cleanup of the test-DB clients already auto-created during the v1 e2e run — handled by manual SQL outside the code change.

## Architecture

All changes are local to `lib/imports/bc2-client-resolver.ts`. Public types and the `resolveTitle(rawTitle, knownClients)` signature are unchanged. Two modifications:

1. **3-char minimum on auto-create paths.** Every code path that returns `matchedBy: "auto-create-pending"` checks the candidate prefix length. Sub-3-char prefixes fall through to the next step (or to `"none"` if at the end of the chain).
2. **New Step 2.5 — colon variant.** A single new step inserted between the existing Step 2 (compound normalized-prefix match) and Step 3 (FALLBACK parsed-code path). Handles the two colon shapes deterministically.

The step ordering (matches the existing labels in `bc2-client-resolver.ts`):

| Step | Trigger | Outcome |
|---|---|---|
| pre | Empty/whitespace input | `none` |
| 1 (parser-first) | PRIMARY parses → known client | `code` |
| 1 (parser-first) | PRIMARY parses → unknown client, code length ≥3 | `auto-create-pending` |
| 1 (parser-first) | PRIMARY parses → unknown client, code length <3 | falls through |
| 2 (compound match) | normalized-prefix lookup hits | `code` (with num) or `name` (no num) |
| **2.5 (colon variant — NEW)** | colon split, single-word lead ≥3, rest has num | `code` if known, else `auto-create-pending` |
| **2.5 (colon variant — NEW)** | colon split, lead matches known client via normalized lookup | `name` |
| **2.5 (colon variant — NEW)** | colon split, lead unknown, no num signal | falls through |
| 3 (FALLBACK parsed-code) | FALLBACK parsed.code, length ≥3 | `auto-create-pending` |
| 3 (FALLBACK parsed-code) | FALLBACK parsed.code, length <3 | falls through |
| 4 (lead-word + num marker) | `^[A-Za-z]+\b` lead, length ≥3, `-\d` in body | `auto-create-pending` |
| 4 (lead-word + num marker) | length <3 or no num marker | falls through |
| 5 | none of the above | `none` |

## Algorithm — Step 2.5 (colon variant)

```
const colonIdx = trimmed.indexOf(":");
if (colonIdx > 0) {
  const lead = trimmed.slice(0, colonIdx).trim();
  const rest = trimmed.slice(colonIdx + 1).trim();

  // Case A: single-word lead + rest starts with num-dash-title
  if (/^[A-Za-z]+$/.test(lead) && lead.length >= 3) {
    const numTitleMatch = rest.match(/^(\d{1,5}[A-Za-z]*)\s*[-:\s]\s*(.+)$/);
    if (numTitleMatch) {
      const codeNorm = normalize(lead);
      const matched = index.find(e => e.norm === codeNorm);
      if (matched) {
        return {
          clientId: matched.client.id,
          matchedBy: "code",
          code: matched.client.code,
          num: numTitleMatch[1],
          title: numTitleMatch[2].trim(),
          confidence: "high"
        };
      }
      // Unknown client + clean num signal → auto-create candidate.
      return {
        clientId: null,
        matchedBy: "auto-create-pending",
        code: lead,
        num: numTitleMatch[1],
        title: numTitleMatch[2].trim(),
        confidence: "medium",
        autoCreatePrefix: lead
      };
    }
  }

  // Case B: lead matches a known client by normalized prefix lookup.
  // Allows multi-word lead like "Shalom Institute" → norm "shalominstitute".
  const leadNorm = normalize(lead);
  const matched = longestPrefixMatch(leadNorm, index);
  if (matched && matched.norm === leadNorm) {
    return {
      clientId: matched.client.id,
      matchedBy: "name",
      code: matched.client.code,
      num: null,
      title: rest,
      confidence: "medium"
    };
  }
  // Lead doesn't match; fall through. Do NOT auto-create from colon-only signal.
}
```

Note: Case B uses `longestPrefixMatch` followed by an equality check (`matched.norm === leadNorm`). This is intentional. A `startsWith` semantics would let `Shalom Industries: Infographic` match `Shalom Institute` — wrong. Equality enforces that the full lead, ignoring whitespace and dashes/underscores/dots, equals a known client norm.

## 3-char gate — code paths affected

Each of the following currently emits `matchedBy: "auto-create-pending"` without a length check. Each gets a `prefix.length >= 3` guard. On reject, the function returns `none` if it's the last applicable step, otherwise falls through.

1. **Step 1 (parser-first, unknown client)** — `parsed.code` from PRIMARY. PRIMARY's `[A-Za-z]+` lets through 1- and 2-char codes when the rest matches.
2. **Step 3 (FALLBACK parsed-code, no num)** — `parsed.code` from FALLBACK. Same regex, same risk.
3. **Step 4 (lead-word + hasNumMarker)** — `leadWordMatch[1]`. The path that fires for `Merrill Lynch-001: ...`. Sub-3 leads were already rare here but the guard makes the rule explicit and uniform.

The new Step 2.5 Case A inherits the gate via the explicit `lead.length >= 3` check; Case B has no length check because it requires an exact match against a known client (length is implicitly bounded by the client list).

## Tests

**File:** `tests/unit/bc2-client-resolver.test.ts` — append fixtures, do not modify existing.

```ts
// Step 3.5 Case A — colon-with-num, known client
{ raw: "GX: 0042-Brand refresh", matchedBy: "code", clientId: "id-gx", code: "GX", num: "0042", title: "Brand refresh", confidence: "high" }

// Step 3.5 Case A — colon-with-num, unknown client (auto-create candidate)
it("colon-with-num auto-create", () => {
  const r = resolveTitle("EcoTech: 001-Energy Int'l Logo", KNOWN);
  expect(r.matchedBy).toBe("auto-create-pending");
  expect(r.code).toBe("EcoTech");
  expect(r.num).toBe("001");
  expect(r.title).toBe("Energy Int'l Logo");
  expect(r.autoCreatePrefix).toBe("EcoTech");
});

// Step 3.5 Case B — colon-no-num, known multi-word client
// (assumes KNOWN includes a "Shalom Institute" client with code "ShalomInstitute" or name "Shalom Institute")
// Add to KNOWN:
//   { id: "id-shalom", code: "ShalomInstitute", name: "Shalom Institute" }
{ raw: "Shalom Institute: Infographic", matchedBy: "name", clientId: "id-shalom", code: "ShalomInstitute", num: null, title: "Infographic", confidence: "medium" }

// Step 3.5 Case B — colon-no-num, unknown lead → orphan
{ raw: "Huntsman: Email Change", matchedBy: "none", clientId: null, code: null, num: null, title: "Huntsman: Email Change", confidence: "low" }

// Step 3.5 — false-positive resistance
{ raw: "TODO: Pick up dry cleaning", matchedBy: "none", clientId: null, code: null, num: null, title: "TODO: Pick up dry cleaning", confidence: "low" }

// Auto-create gate — short code rejected
{ raw: "S&S: ToDo", matchedBy: "none", clientId: null, code: null, num: null, title: "S&S: ToDo", confidence: "low" }
{ raw: "S-001: Foo", matchedBy: "none", clientId: null, code: null, num: null, title: "S-001: Foo", confidence: "low" }
```

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts` — all existing fixtures must remain green; new fixtures must pass.

Run: `pnpm test` — full regression. Classifier drift-guard already covered in v1; no change expected here.

## Verification

1. Unit tests pass.
2. `pnpm exec tsc --noEmit` clean.
3. Reset test DB (`scripts/reset-bc2-import-data.ts --yes`) to clear v1's bad auto-creates.
4. Re-run `npx tsx scripts/migrate-bc2.ts --mode=full --projects=all` against test DB.
5. Inspect new `tmp/bc2-import-summary.json`:
   - `auto_created_clients` should NOT contain `S` (gate works).
   - `matched_by["auto-create-pending"]` should drop from 10 → ~7 (the 3 `S` projects move to orphan).
   - `matched_by["code"]` should rise by ~3 (the 3 `EcoTech: NNN-...` style projects, if any beyond the one observed).
   - `orphans_count` should drop by the colon-variant matches (~2-4 fewer).

## Risk

- **Low** — changes are additive (one new step) plus three guard checks. No existing behavior altered for inputs that currently match the existing steps.
- The new Case B uses `longestPrefixMatch` + equality check, not `startsWith`. Worst case is a multi-word lead that exactly normalizes to a known-client norm but isn't actually that client. Mitigation: full match is required, so collisions are unlikely on real client data.
- Re-running migrate-bc2 against test DB after a reset is destructive (drops projects/threads/comments). Reset script has `--yes` guard. Operator action only — no automatic reset wired in.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/imports/bc2-client-resolver.ts` | Modify | Add Step 3.5 (colon variant). Add `length >= 3` guards to three existing auto-create paths. Public types + signature unchanged. |
| `tests/unit/bc2-client-resolver.test.ts` | Modify | Append new fixtures + new `KNOWN` entry (`Shalom Institute`). Existing fixtures untouched. |
