# BC2 Resolver Remediation v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten `bc2-client-resolver` to (a) reject sub-3-char auto-create candidates and (b) handle two colon-form title variants (`Code: NUM-Title`, `Code: Title`) so the BC2 import produces fewer spurious clients and fewer orphans.

**Architecture:** All changes are local to `lib/imports/bc2-client-resolver.ts`. Add a new Step 2.5 between the existing Step 2 (compound normalized-prefix match) and Step 3 (FALLBACK parsed-code). Add `prefix.length >= 3` guards on the three existing paths that emit `matchedBy: "auto-create-pending"`. Public types and `resolveTitle` signature unchanged.

**Tech Stack:** TypeScript, Node 24, vitest, existing `parseProjectTitle`/`Bc2Client` infrastructure, Supabase Postgres (test project `anrnlmmanhrddkvrnooe`), Supabase MCP server.

**Spec:** `docs/superpowers/specs/2026-05-05-bc2-resolver-remediation-v2-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `tests/unit/bc2-client-resolver.test.ts` | Modify | Add `Shalom Institute` to `KNOWN`. Append fixtures: colon-with-num known/unknown, colon-no-num known multi-word, colon-no-num unknown (orphan), TODO-style false-positive (orphan), `S&S: ToDo` (orphan via gate), `S-001: Foo` (orphan via gate). Existing fixtures untouched. |
| `lib/imports/bc2-client-resolver.ts` | Modify | Add `prefix.length >= 3` guard to Step 1 (parser-first unknown), Step 3 (FALLBACK parsed.code), Step 4 (lead-word + hasNumMarker). Insert Step 2.5 (colon variant) between Step 2 and Step 3. Public types + signature unchanged. |

---

## Task 1: Add v2 test fixtures (red)

**Files:**
- Modify: `tests/unit/bc2-client-resolver.test.ts`

Append fixtures to the existing `fixtures` array and add two standalone `it(...)` tests at the end of the `describe("resolveTitle", ...)` block. Tests are red because no implementation has run yet.

- [ ] **Step 1: Read current test file**

Read `tests/unit/bc2-client-resolver.test.ts` to see the `KNOWN` array, `fixtures` array, and the trailing standalone `it(...)` blocks.

- [ ] **Step 2: Add `Shalom Institute` to `KNOWN`**

Find the `KNOWN: KnownClient[]` array. Append a new entry at the end of the array (before the closing `]`):

```ts
  { id: "id-shalom", code: "ShalomInstitute", name: "Shalom Institute" }
```

The full array becomes:

```ts
const KNOWN: KnownClient[] = [
  { id: "id-gx", code: "GX", name: "Glyphix" },
  { id: "id-poms", code: "POMS", name: "Poms & Associates" },
  { id: "id-jfla", code: "JFLA", name: "JFLA" },
  { id: "id-callpf", code: "CalLPF", name: "CalLPF" },
  { id: "id-getdis", code: "GetDismissed", name: "GetDismissed" },
  { id: "id-bird", code: "Bird", name: "Bird Marella" },
  { id: "id-brd", code: "BRD", name: "Bird Marella" },
  { id: "id-birdmarella", code: "BirdMarella", name: "Bird Marella" },
  { id: "id-blade", code: "BladeGuard", name: "BladeGuard" },
  { id: "id-mmr", code: "MMR", name: "MMR" },
  { id: "id-abi", code: "ABI", name: "ABI" },
  { id: "id-shalom", code: "ShalomInstitute", name: "Shalom Institute" }
];
```

- [ ] **Step 3: Append fixtures to the `fixtures` array**

Find the `const fixtures: Fixture[] = [` array. Append these entries before the closing `];`:

```ts
  // v2: colon-with-num, known client → matchedBy "code"
  { raw: "GX: 0042-Brand refresh", matchedBy: "code", clientId: "id-gx", code: "GX", num: "0042", title: "Brand refresh", confidence: "high" },

  // v2: colon-no-num, known multi-word client → matchedBy "name"
  { raw: "Shalom Institute: Infographic", matchedBy: "name", clientId: "id-shalom", code: "ShalomInstitute", num: null, title: "Infographic", confidence: "medium" },

  // v2: colon-no-num, unknown lead → orphan (don't auto-create from colon-only)
  { raw: "Huntsman: Email Change", matchedBy: "none", clientId: null, code: null, num: null, title: "Huntsman: Email Change", confidence: "low" },

  // v2: false-positive resistance (TODO is not a known client + no num)
  { raw: "TODO: Pick up dry cleaning", matchedBy: "none", clientId: null, code: null, num: null, title: "TODO: Pick up dry cleaning", confidence: "low" },

  // v2: 3-char gate — sub-3 lead rejected (S from "S&S: ToDo" cleared via colon Case A num check; falls through to none)
  { raw: "S&S: ToDo", matchedBy: "none", clientId: null, code: null, num: null, title: "S&S: ToDo", confidence: "low" },

  // v2: 3-char gate — Step 1 parser-first sub-3 unknown code rejected
  { raw: "S-001: Foo", matchedBy: "none", clientId: null, code: null, num: null, title: "S-001: Foo", confidence: "low" }
```

- [ ] **Step 4: Append standalone test for colon-with-num auto-create**

Find the trailing `it("auto-create-pending when prefix has num but no client match", () => { ... })` block. Insert a new `it(...)` block AFTER it but before the closing `});` of the `describe`:

```ts
  it("colon-with-num auto-create when lead is unknown (Step 2.5 Case A)", () => {
    const r = resolveTitle("EcoTech: 001-Energy Int'l Logo", KNOWN);
    expect(r.matchedBy).toBe("auto-create-pending");
    expect(r.code).toBe("EcoTech");
    expect(r.num).toBe("001");
    expect(r.title).toBe("Energy Int'l Logo");
    expect(r.confidence).toBe("medium");
    expect(r.autoCreatePrefix).toBe("EcoTech");
  });
```

- [ ] **Step 5: Run tests to confirm new fixtures fail**

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts`
Expected: tests for the new fixtures FAIL (most resolve to current behavior — likely `none`, or `auto-create-pending` for `S-001: Foo`); existing fixtures still PASS. Specifically:
  - `[code] "GX: 0042-Brand refresh"` — fails (currently returns `name` matchedBy or `none`)
  - `[name] "Shalom Institute: Infographic"` — fails (currently `none`)
  - `[none] "Huntsman: Email Change"` — passes (already orphan)
  - `[none] "TODO: Pick up dry cleaning"` — passes (already orphan)
  - `[none] "S&S: ToDo"` — fails (currently auto-create-pending with code `S`)
  - `[none] "S-001: Foo"` — fails (currently auto-create-pending with code `S`)
  - `colon-with-num auto-create` test — fails (currently `none`)

- [ ] **Step 6: Commit**

```bash
git add tests/unit/bc2-client-resolver.test.ts
git commit -m "test(bc2): resolver v2 fixtures for colon variants + 3-char gate (red)"
```

---

## Task 2: Add 3-char gate to existing auto-create paths

**Files:**
- Modify: `lib/imports/bc2-client-resolver.ts`

Three existing paths emit `matchedBy: "auto-create-pending"` without a length check. Add `prefix.length >= 3` guards. On reject, fall through to the next step (or to `none` if last).

- [ ] **Step 1: Read current resolver**

Read `lib/imports/bc2-client-resolver.ts` end-to-end so the four existing step labels are clear: Step 1 (parser-first), Step 2 (compound match), Step 3 (FALLBACK parsed.code), Step 4 (lead-word + hasNumMarker).

- [ ] **Step 2: Gate Step 1 (parser-first, unknown client)**

Find this block in `resolveTitle`:

```ts
  // ── Step 1: Parser-first path. PRIMARY hit means clean code+num.
  const parsed = parseProjectTitle(trimmed);
  if (parsed.code && parsed.num) {
    const codeNorm = normalize(parsed.code);
    const matched = index.find((e) => e.norm === codeNorm);
    if (matched) {
      return {
        clientId: matched.client.id,
        matchedBy: "code",
        code: matched.client.code,
        num: parsed.num,
        title: parsed.title,
        confidence: "high"
      };
    }
    // Clean parse, unknown client. Auto-create candidate.
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: parsed.code,
      num: parsed.num,
      title: parsed.title,
      confidence: "medium",
      autoCreatePrefix: parsed.code
    };
  }
```

Replace the inner `// Clean parse, unknown client...` early-return with a length check that falls through if the code is too short:

```ts
    // Clean parse, unknown client. Auto-create candidate (gated to prefix length >= 3).
    if (parsed.code.length >= 3) {
      return {
        clientId: null,
        matchedBy: "auto-create-pending",
        code: parsed.code,
        num: parsed.num,
        title: parsed.title,
        confidence: "medium",
        autoCreatePrefix: parsed.code
      };
    }
    // Sub-3 unknown code: fall through to remaining steps.
```

- [ ] **Step 3: Gate Step 3 (FALLBACK parsed.code)**

Find this block:

```ts
  // ── Step 3: No compound match. If parser caught a code (FALLBACK path, no num),
  // treat as auto-create-pending so caller can decide whether to materialize a new client.
  if (parsed.code) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: parsed.code,
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: parsed.code
    };
  }
```

Replace with:

```ts
  // ── Step 3: No compound match. If parser caught a code (FALLBACK path, no num),
  // treat as auto-create-pending so caller can decide whether to materialize a new client.
  // Gated: prefix length >= 3 to avoid spurious 1-2 char clients.
  if (parsed.code && parsed.code.length >= 3) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: parsed.code,
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: parsed.code
    };
  }
```

- [ ] **Step 4: Gate Step 4 (lead-word + hasNumMarker)**

Find this block:

```ts
  // ── Step 4: Multi-word prefix where parser couldn't extract a code but the title
  // has a `-\d` marker (e.g. "Merrill Lynch-001: ..."). Take the leading letter-word
  // as the auto-create candidate.
  const leadWordMatch = trimmed.match(/^([A-Za-z]+)\b/);
  const hasNumMarker = /-\d{1,5}[A-Za-z]*/.test(trimmed);
  if (leadWordMatch && hasNumMarker) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: leadWordMatch[1],
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: leadWordMatch[1]
    };
  }
```

Replace with:

```ts
  // ── Step 4: Multi-word prefix where parser couldn't extract a code but the title
  // has a `-\d` marker (e.g. "Merrill Lynch-001: ..."). Take the leading letter-word
  // as the auto-create candidate. Gated: prefix length >= 3.
  const leadWordMatch = trimmed.match(/^([A-Za-z]+)\b/);
  const hasNumMarker = /-\d{1,5}[A-Za-z]*/.test(trimmed);
  if (leadWordMatch && hasNumMarker && leadWordMatch[1].length >= 3) {
    return {
      clientId: null,
      matchedBy: "auto-create-pending",
      code: leadWordMatch[1],
      num: null,
      title: "",
      confidence: "medium",
      autoCreatePrefix: leadWordMatch[1]
    };
  }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run resolver tests**

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts`
Expected: progression — `[none] "S-001: Foo"` and `[none] "S&S: ToDo"` now PASS (gate kicks in). Colon-variant fixtures still FAIL (Step 2.5 not yet added). Existing fixtures unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/imports/bc2-client-resolver.ts
git commit -m "feat(bc2): 3-char gate on resolver auto-create paths"
```

---

## Task 3: Insert Step 2.5 (colon variant)

**Files:**
- Modify: `lib/imports/bc2-client-resolver.ts`

Insert one new step between the existing Step 2 (compound match) and Step 3 (FALLBACK parsed.code).

- [ ] **Step 1: Locate insertion point**

Find the end of the existing Step 2 block. The structure is:

```ts
  const matched = longestPrefixMatch(normFull, index);
  if (matched) {
    // ... matchedBy "code" or "name" returned
  }

  // ── Step 3: No compound match. If parser caught a code (FALLBACK path, no num),
```

Insert the new block between the closing brace of `if (matched) { ... }` and the `// ── Step 3:` comment.

- [ ] **Step 2: Insert Step 2.5 — colon variant**

Insert this block immediately after the Step 2 `if (matched) { ... }` block (before `// ── Step 3:`):

```ts
  // ── Step 2.5: Colon variant. Handle "Code: NUM-Title" and "Code: Title" shapes
  // that PRIMARY/FALLBACK don't catch. Only fires when a colon is present.
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const lead = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    // Case A: single-word lead + rest starts with num-(dash|colon|space)-title.
    // Lead must be all-letters and >=3 chars (auto-create gate).
    if (/^[A-Za-z]+$/.test(lead) && lead.length >= 3) {
      const numTitleMatch = rest.match(/^(\d{1,5}[A-Za-z]*)\s*[-:\s]\s*(.+)$/);
      if (numTitleMatch) {
        const codeNorm = normalize(lead);
        const matchedColon = index.find((e) => e.norm === codeNorm);
        if (matchedColon) {
          return {
            clientId: matchedColon.client.id,
            matchedBy: "code",
            code: matchedColon.client.code,
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
    // Equality (not startsWith) so "Shalom Industries" does not bind to "Shalom Institute".
    const leadNorm = normalize(lead);
    const matchedLead = longestPrefixMatch(leadNorm, index);
    if (matchedLead && matchedLead.norm === leadNorm) {
      return {
        clientId: matchedLead.client.id,
        matchedBy: "name",
        code: matchedLead.client.code,
        num: null,
        title: rest,
        confidence: "medium"
      };
    }
    // Lead doesn't match; fall through. Do NOT auto-create from colon-only signal.
  }

```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run resolver tests**

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts`
Expected: ALL tests PASS, including the v2 fixtures and the colon-with-num auto-create test.

If a test fails, the most likely causes:
- Case A regex on `rest` not matching expected separator class. Re-read the regex: `^(\d{1,5}[A-Za-z]*)\s*[-:\s]\s*(.+)$` — num then optional whitespace then one of `-` / `:` / whitespace then optional whitespace then title.
- Case B falsely binding via `longestPrefixMatch` when norms don't equal — recheck the equality guard.
- `Shalom Institute` not in `KNOWN` (Task 1 Step 2 was skipped or reverted).

- [ ] **Step 5: Commit**

```bash
git add lib/imports/bc2-client-resolver.ts
git commit -m "feat(bc2): resolver Step 2.5 colon variant (Code: NUM-Title, Code: Title)"
```

---

## Task 4: Full regression + final commit

**Files:**
- (None — verification only.)

- [ ] **Step 1: Run full unit suite**

Run: `pnpm test`
Expected: all tests PASS, no regressions in any other suite.

- [ ] **Step 2: Typecheck full project**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Confirm no untracked artifacts**

Run: `git status`
Expected: clean working tree (Tasks 1-3 commits already made).

---

## Task 5 (optional): Re-run e2e against test DB

**Files:**
- (None — runtime verification only.)

This task validates the v2 changes against the full 3691-row BC2 corpus on the test Supabase project. Skip if you only need code-level validation. Requires `.env.test.local` populated (see v1 plan task 13).

- [ ] **Step 1: Swap env**

```
cp .env.local .env.local.prod-backup
cp .env.test.local .env.local
```

- [ ] **Step 2: Reset test-DB project data**

Resets v1's bad auto-creates (`Merrill`, `Rainbow`, `S`, `Senior` clients + their projects) so the v2 run produces clean metrics.

```
npx tsx scripts/reset-bc2-import-data.ts --yes
```

Expected: `Reset complete: projects, discussions, comments, files, import maps/jobs cleared.`

Note: this preserves the `clients` table. The v1-auto-created clients (`Merrill`, `Rainbow`, `S`, `Senior`) remain in the table and may still match if their codes show up in BC2 data. To fully clean, separately run:

```sql
delete from clients where code in ('Merrill', 'Rainbow', 'S', 'Senior');
```

(via Supabase MCP `execute_sql` or `psql`).

- [ ] **Step 3: Run migrate-bc2 against test DB**

Use `--mode=full --projects=all`. The threads/comments phase is slow; for a faster v2 metric check, `--mode=full --projects=active` is acceptable since the resolver runs in the pre-pass on the FULL corpus regardless.

```
npx tsx scripts/migrate-bc2.ts --mode=full --projects=all > tmp/migrate-bc2-v2-run.log 2>&1
```

Run in background and monitor `tmp/migrate-bc2-v2-run.log` for `Done —` or `[FATAL]`.

- [ ] **Step 4: Inspect summary**

```
cat tmp/bc2-import-summary.json
```

Expected deltas vs v1 run:
- `auto_created_clients` no longer contains `S` (gate works).
- `matched_by["auto-create-pending"]` drops by ~3 (the 3 `S` projects move to orphan).
- `matched_by["code"]` rises by however many `EcoTech: 001-...` style projects existed (only 1 observed in the v1 run).
- `orphans_count` drops by the colon-variant matches (1-3 fewer).
- `dup_suffixes_assigned` may shift slightly if any of the new colon-resolved projects collide with existing `(code, num)` groups.

- [ ] **Step 5: Restore env**

```
mv .env.local.prod-backup .env.local
```

- [ ] **Step 6: No commit**

This task produces no git changes — verification only.
