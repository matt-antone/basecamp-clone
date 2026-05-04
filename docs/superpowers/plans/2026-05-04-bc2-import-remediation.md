# BC2 Import Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BC2 → Supabase + Dropbox migration produce correct, non-cascading data on a re-run with the existing 3691-row corpus, by fixing parser regex gaps, adding compound-client-code resolution, allowing code-less projects, and disambiguating duplicate `(code, num)` groups.

**Architecture:** Pure parser regex relaxed in place. New pure resolver module `bc2-client-resolver.ts` performs normalized lookup against `clients`. Migrator integrates resolver, branches on outcome, runs a dup-suffix pre-pass, emits orphans CSV. Schema migration drops `NOT NULL` on five identity columns and the `(client_id, project_seq)` unique index so variant projects can share a sequence. End-to-end verification runs against an isolated Supabase project (`anrnlmmanhrddkvrnooe`) + sandbox Dropbox folder.

**Tech Stack:** TypeScript, Node 24, vitest, `pg`, existing `Bc2Fetcher`/`Bc2Client` infrastructure, Supabase Postgres, Supabase MCP server (already registered in `.mcp.json`).

**Spec:** `docs/superpowers/specs/2026-05-04-bc2-import-remediation-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/imports/bc2-transformer.ts` | Modify | Replace `PRIMARY_PATTERN` with extended regex (1-5 digit num, optional letter suffix, colon-or-whitespace separator). Keep `FALLBACK_PATTERN` as-is. `parseProjectTitle` signature unchanged. |
| `tests/unit/bc2-transformer.test.ts` | Modify | Add fixtures for missing-colon, short-num, long-num, suffixed-num. Existing fixtures must remain green. |
| `tests/unit/bc2-title-classifier.test.ts` | Modify | After parser change, drift-guard test may flag re-classified fixtures. Update fixture expectations as needed. |
| `lib/imports/bc2-client-resolver.ts` | Create | Pure module: `resolveTitle(rawTitle, knownClients) → ResolvedTitle`. Normalized prefix lookup against client codes + names. |
| `tests/unit/bc2-client-resolver.test.ts` | Create | Fixture-driven coverage for each `matchedBy` outcome (code / name / auto-create-pending / none) plus word-boundary safety. |
| `supabase/migrations/0028_relax_project_identity_constraints.sql` | Create | Drop `NOT NULL` on `project_code`, `project_seq`, `client_slug`, `project_slug`, `storage_project_dir`. Drop `idx_projects_client_seq_unique`. |
| `scripts/migrate-bc2.ts` | Modify | Pre-fetch known clients. Replace `parseProjectTitle` call with `resolveTitle`. Branch on `matchedBy`. Add dup-suffix pre-pass. Add `--allow-orphans` flag. Emit orphan CSV + summary JSON. |
| `scripts/seed-clients-from-prod.ts` | Create | One-shot: copy `clients` rows from `PROD_DATABASE_URL` to `DATABASE_URL` (test DB). Idempotent. |
| `.env.test.local` | Create (locally, gitignored) | Test-environment env file. Holds test `DATABASE_URL`, sandbox `DROPBOX_PROJECTS_ROOT_FOLDER`. |

---

## Task 1: Extend parser regex

**Files:**
- Modify: `lib/imports/bc2-transformer.ts:10-11`

The current `PRIMARY_PATTERN` requires 3-4 digits + colon. The new regex accepts 1-5 digits, optional letter suffix on the num, and either `:` or whitespace as separator.

- [ ] **Step 1: Read current regex constants**

Read `lib/imports/bc2-transformer.ts` lines 1-35 to confirm current state matches the spec assumption (you should see `PRIMARY_PATTERN`, `FALLBACK_PATTERN`, `parseProjectTitle`).

- [ ] **Step 2: Replace `PRIMARY_PATTERN`**

In `lib/imports/bc2-transformer.ts`, replace this line:

```ts
const PRIMARY_PATTERN = /^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/;
```

with:

```ts
// Extended pattern: code-num separator title.
// num: 1–5 digits with optional letter suffix (variants like 0042b, 049A).
// separator: ":" OR whitespace (handles missing-colon titles).
const PRIMARY_PATTERN = /^([A-Za-z]+)-(\d{1,5}[A-Za-z]*)\s*[:\s]\s*(.+)$/;
```

Leave `FALLBACK_PATTERN` and `parseProjectTitle` unchanged (the function body still works since the capture groups are at the same indices).

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run existing parser tests to see current state**

Run: `pnpm test tests/unit/bc2-transformer.test.ts`
Expected: existing tests still PASS (the new regex is a strict superset of the old one for all currently-tested inputs).

- [ ] **Step 5: Commit**

```bash
git add lib/imports/bc2-transformer.ts
git commit -m "feat(bc2): extend parser regex to 1-5 digit num + letter suffix"
```

---

## Task 2: Add parser fixtures for new cases

**Files:**
- Modify: `tests/unit/bc2-transformer.test.ts`

- [ ] **Step 1: Read existing test file**

Read `tests/unit/bc2-transformer.test.ts` to find the `describe("parseProjectTitle", ...)` block. Locate the last `it(...)` inside it.

- [ ] **Step 2: Add new fixtures inside `describe("parseProjectTitle", ...)`**

Append these tests after the existing ones, inside the same `describe` block:

```ts
  it("parses missing-colon (whitespace separator)", () => {
    const r = parseProjectTitle("POMS-1511 Scissor Lift Certificates");
    expect(r).toEqual({ code: "POMS", num: "1511", title: "Scissor Lift Certificates" });
  });

  it("parses short-num (1 or 2 digits)", () => {
    const r = parseProjectTitle("Union-13: KubeCon Video Re-edit");
    expect(r).toEqual({ code: "Union", num: "13", title: "KubeCon Video Re-edit" });
  });

  it("parses long-num (5 digits)", () => {
    const r = parseProjectTitle("GX-12345: Foo");
    expect(r).toEqual({ code: "GX", num: "12345", title: "Foo" });
  });

  it("parses suffixed-num uppercase variant", () => {
    const r = parseProjectTitle("MMR-049A: Images 1804 2002 2204 2402");
    expect(r).toEqual({ code: "MMR", num: "049A", title: "Images 1804 2002 2204 2402" });
  });

  it("parses suffixed-num lowercase variant", () => {
    const r = parseProjectTitle("JFLA-188a: Changes to JFLA App");
    expect(r).toEqual({ code: "JFLA", num: "188a", title: "Changes to JFLA App" });
  });

  it("parses missing-colon with short num", () => {
    const r = parseProjectTitle("Union-68 SciPy Webinar Title Card");
    expect(r).toEqual({ code: "Union", num: "68", title: "SciPy Webinar Title Card" });
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm test tests/unit/bc2-transformer.test.ts`
Expected: All tests PASS, including the new ones.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/bc2-transformer.test.ts
git commit -m "test(bc2): cover missing-colon, short-num, long-num, suffixed-num"
```

---

## Task 3: Verify classifier drift guard still green

**Files:**
- Modify (only if needed): `tests/unit/bc2-title-classifier.test.ts`

Parser regex relaxation may cause some classifier fixtures previously marked anomalous to now parse as `clean` via `parseProjectTitle`, which could break the drift-guard assertion.

- [ ] **Step 1: Run classifier tests**

Run: `pnpm test tests/unit/bc2-title-classifier.test.ts`

- [ ] **Step 2: Inspect any failures**

If all 34 tests pass, proceed to Step 4 (no commit needed for this task).

If failures appear, they will be in the `drift guard: clean fixtures must parse via parseProjectTitle` block — meaning a `clean` fixture's expected `parseProjectTitle` output changed. Read the failure messages to identify which fixtures are affected.

The likely root cause: the new parser is more permissive, so a fixture marked `clean-3digit-num` may still pass (parser still extracts the same code/num/title), but a fixture marked `short-num` would now successfully parse via `parseProjectTitle` even though the classifier still marks it `short-num`.

The drift guard only runs against fixtures with `primaryClass: "clean"` or `"clean-3digit-num"`, so changes to other classes won't break it. If failures appear here, the most likely reason is whitespace handling on a fixture like `"  GX-0042: Foo  "` — the old behavior was tested with `String(f.raw).trim()`. Confirm that's still the case in the test file.

- [ ] **Step 3: Update fixtures only if they're genuinely incorrect**

If a `clean` fixture's expected output is now wrong because the parser produces a different (better) result, update the expected values. Do NOT relax the assertion. The drift guard exists to catch regressions; if the parser becomes more permissive, the fixtures should reflect the new correct output.

If a fixture should now classify as `clean` rather than another class because the parser handles it, that's a SEPARATE classifier change (out of scope for this plan). Do not modify the classifier as part of this task.

- [ ] **Step 4: Commit if changes were made**

If Steps 2-3 required edits:

```bash
git add tests/unit/bc2-title-classifier.test.ts
git commit -m "test(bc2): align classifier drift-guard fixtures with extended parser"
```

If no changes: skip the commit, mark this task complete.

---

## Task 4: Resolver types + skeleton

**Files:**
- Create: `lib/imports/bc2-client-resolver.ts`

Create the module with types and a stub `resolveTitle` returning `matchedBy: "none"`. Tests come next, then real logic.

- [ ] **Step 1: Create the file**

```ts
// lib/imports/bc2-client-resolver.ts
import { parseProjectTitle } from "./bc2-transformer";

export interface KnownClient {
  id: string;
  code: string;
  name: string;
}

export type MatchedBy = "code" | "name" | "auto-create-pending" | "none";
export type Confidence = "high" | "medium" | "low";

export interface ResolvedTitle {
  clientId: string | null;
  matchedBy: MatchedBy;
  code: string | null;
  num: string | null;
  title: string;
  confidence: Confidence;
  /** When matchedBy = "auto-create-pending", this is the prefix to use for the new client (untrimmed-of-internal-ws). */
  autoCreatePrefix?: string;
}

export function resolveTitle(rawTitle: string | null | undefined, knownClients: KnownClient[]): ResolvedTitle {
  void knownClients;
  return {
    clientId: null,
    matchedBy: "none",
    code: null,
    num: null,
    title: String(rawTitle ?? "").trim(),
    confidence: "low"
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/bc2-client-resolver.ts
git commit -m "feat(bc2): scaffold client resolver module"
```

---

## Task 5: Resolver fixture-driven test suite (red)

**Files:**
- Create: `tests/unit/bc2-client-resolver.test.ts`

Write the full test suite first. All non-trivial tests should fail because the resolver is a stub.

- [ ] **Step 1: Create the test file**

```ts
// tests/unit/bc2-client-resolver.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveTitle,
  type KnownClient,
  type MatchedBy,
  type Confidence
} from "@/lib/imports/bc2-client-resolver";

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
  { id: "id-abi", code: "ABI", name: "ABI" }
];

interface Fixture {
  raw: string;
  matchedBy: MatchedBy;
  clientId: string | null;
  code: string | null;
  num: string | null;
  title: string;
  confidence: Confidence;
}

const fixtures: Fixture[] = [
  // matchedBy: "code" — clean parse, code maps to known client
  { raw: "GX-0042: Brand refresh", matchedBy: "code", clientId: "id-gx", code: "GX", num: "0042", title: "Brand refresh", confidence: "high" },
  { raw: "POMS-1278 Safety Spotlight", matchedBy: "code", clientId: "id-poms", code: "POMS", num: "1278", title: "Safety Spotlight", confidence: "high" },

  // matchedBy: "code" via compound (normalized prefix lookup)
  { raw: "Cal-LPF-003: One Sheet Overview", matchedBy: "code", clientId: "id-callpf", code: "CalLPF", num: "003", title: "One Sheet Overview", confidence: "high" },
  { raw: "Get Dismissed-022: Website Updates", matchedBy: "code", clientId: "id-getdis", code: "GetDismissed", num: "022", title: "Website Updates", confidence: "high" },

  // matchedBy: "code" — suffixed num preserved
  { raw: "MMR-049A: Images 1804", matchedBy: "code", clientId: "id-mmr", code: "MMR", num: "049A", title: "Images 1804", confidence: "high" },
  { raw: "JFLA-188a: Changes to JFLA App", matchedBy: "code", clientId: "id-jfla", code: "JFLA", num: "188a", title: "Changes to JFLA App", confidence: "high" },

  // matchedBy: "name" via compound — no num
  { raw: "Bird Marella - Website Updates", matchedBy: "name", clientId: "id-birdmarella", code: "BirdMarella", num: null, title: "Website Updates", confidence: "medium" },
  { raw: "BirdMarella-ToDo: Header Photo Fix", matchedBy: "name", clientId: "id-birdmarella", code: "BirdMarella", num: null, title: "ToDo: Header Photo Fix", confidence: "medium" },
  { raw: "BladeGuard site recovery", matchedBy: "name", clientId: "id-blade", code: "BladeGuard", num: null, title: "site recovery", confidence: "medium" },

  // matchedBy: "auto-create-pending" — clean parse, code unknown
  { raw: "Merrill Lynch-001: Tracy Group Name", matchedBy: "auto-create-pending", clientId: null, code: "Merrill", num: null, title: "", confidence: "medium" },
  // ^ Note: parseProjectTitle splits at first hyphen so "Merrill-Lynch-001" doesn't parse cleanly.
  //   Resolver should still try the lead-prefix path. Compound is unknown → auto-create-pending.
  //   See dedicated test below using a non-spaced compound code.

  // matchedBy: "none" — naked descriptive text, no parseable code
  { raw: "Alliance Business Solutions", matchedBy: "none", clientId: null, code: null, num: null, title: "Alliance Business Solutions", confidence: "low" },
  { raw: "Avivo Domain Names", matchedBy: "none", clientId: null, code: null, num: null, title: "Avivo Domain Names", confidence: "low" },

  // matchedBy: "none" — empty/whitespace
  { raw: "", matchedBy: "none", clientId: null, code: null, num: null, title: "", confidence: "low" },
  { raw: "   ", matchedBy: "none", clientId: null, code: null, num: null, title: "", confidence: "low" }
];

describe("resolveTitle", () => {
  for (const f of fixtures) {
    const label = `[${f.matchedBy}] ${JSON.stringify(f.raw)}`;
    it(label, () => {
      const r = resolveTitle(f.raw, KNOWN);
      expect(r.matchedBy).toBe(f.matchedBy);
      expect(r.clientId).toBe(f.clientId);
      expect(r.code).toBe(f.code);
      expect(r.num).toBe(f.num);
      expect(r.title).toBe(f.title);
      expect(r.confidence).toBe(f.confidence);
    });
  }

  // Word-boundary safety: substring contains-only must NOT match.
  it("does not match clients via substring inside another word", () => {
    // "GX Capabilities" contains "ABI" inside "Capabilities" — must not resolve to ABI.
    const r = resolveTitle("GX Capabilities (Short)", KNOWN);
    // GX is at the start so it should match GX, NOT ABI.
    expect(r.clientId).toBe("id-gx");
    expect(r.matchedBy).toBe("name");
  });

  // Auto-create with hyphenated multi-word prefix: "EcoTech-001: Foo" — no match for EcoTech, has num.
  it("auto-create-pending when prefix has num but no client match", () => {
    const r = resolveTitle("EcoTech-001: Energy Logo", KNOWN);
    expect(r.matchedBy).toBe("auto-create-pending");
    expect(r.code).toBe("EcoTech");
    expect(r.num).toBe("001");
    expect(r.title).toBe("Energy Logo");
    expect(r.confidence).toBe("medium");
    expect(r.autoCreatePrefix).toBe("EcoTech");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts`
Expected: FAIL — most tests fail because the stub returns `matchedBy: "none"` for everything. The two `matchedBy: "none"` fixtures may pass; everything else fails.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/bc2-client-resolver.test.ts
git commit -m "test(bc2): resolver fixture-driven test suite (red)"
```

---

## Task 6: Resolver implementation

**Files:**
- Modify: `lib/imports/bc2-client-resolver.ts`

Implement the lookup algorithm: parse-first, then compound-prefix lookup, then auto-create-pending classification.

- [ ] **Step 1: Replace the resolver implementation**

Replace the entire content of `lib/imports/bc2-client-resolver.ts` with:

```ts
// lib/imports/bc2-client-resolver.ts
import { parseProjectTitle } from "./bc2-transformer";

export interface KnownClient {
  id: string;
  code: string;
  name: string;
}

export type MatchedBy = "code" | "name" | "auto-create-pending" | "none";
export type Confidence = "high" | "medium" | "low";

export interface ResolvedTitle {
  clientId: string | null;
  matchedBy: MatchedBy;
  code: string | null;
  num: string | null;
  title: string;
  confidence: Confidence;
  autoCreatePrefix?: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.]/g, "");
}

interface NormEntry {
  norm: string;
  client: KnownClient;
  source: "code" | "name";
}

function buildIndex(clients: KnownClient[]): NormEntry[] {
  const entries: NormEntry[] = [];
  for (const c of clients) {
    const codeNorm = normalize(c.code);
    if (codeNorm) entries.push({ norm: codeNorm, client: c, source: "code" });
    const nameNorm = normalize(c.name);
    if (nameNorm && nameNorm !== codeNorm) entries.push({ norm: nameNorm, client: c, source: "name" });
  }
  // Longest first for greedy prefix match.
  entries.sort((a, b) => b.norm.length - a.norm.length);
  return entries;
}

/**
 * Find the longest prefix of normLead that equals an indexed key.
 * Returns the matched entry or null.
 */
function longestPrefixMatch(normLead: string, index: NormEntry[]): NormEntry | null {
  for (const e of index) {
    if (normLead === e.norm || normLead.startsWith(e.norm)) {
      return e;
    }
  }
  return null;
}

/**
 * Given the original (untrimmed-of-internal-ws) trimmed title and a matched normalized key,
 * find where the matched prefix ends in the original string.
 * Returns the substring AFTER the matched prefix.
 *
 * Approach: walk character by character through the original trimmed string,
 * accumulating a normalized buffer. When the buffer equals the matched key,
 * that index is the end of the matched prefix.
 */
function stripMatchedPrefix(original: string, matchedKey: string): string {
  let buffer = "";
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    const chLower = ch.toLowerCase();
    if (!/[\s\-_.]/.test(ch)) {
      buffer += chLower;
    }
    if (buffer === matchedKey) {
      return original.slice(i + 1);
    }
  }
  return "";
}

const REMAINDER_NUM_TITLE = /^(\d+[A-Za-z]*)\s*[:\s]\s*(.+)$/;

export function resolveTitle(rawTitle: string | null | undefined, knownClients: KnownClient[]): ResolvedTitle {
  const trimmed = String(rawTitle ?? "").trim();
  if (trimmed === "") {
    return { clientId: null, matchedBy: "none", code: null, num: null, title: "", confidence: "low" };
  }

  const index = buildIndex(knownClients);

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

  // ── Step 2: Compound-prefix lookup against the normalized lead.
  // Take the lead as everything up to the first ":" or first whitespace before digits.
  // Simpler: build a candidate lead by progressively normalizing characters and seeing
  // if the normalized buffer matches any indexed key — handled inside stripMatchedPrefix.
  const normFull = normalize(trimmed);
  const matched = longestPrefixMatch(normFull, index);
  if (matched) {
    const remainderRaw = stripMatchedPrefix(trimmed, matched.norm);
    // Strip leading separators (`-`, ` `, `:`).
    const remainder = remainderRaw.replace(/^[\s\-:]+/, "");
    const numMatch = remainder.match(REMAINDER_NUM_TITLE);
    if (numMatch) {
      return {
        clientId: matched.client.id,
        matchedBy: "code",
        code: matched.client.code,
        num: numMatch[1],
        title: numMatch[2].trim(),
        confidence: "high"
      };
    }
    // No num in remainder: matched by name with no project number.
    return {
      clientId: matched.client.id,
      matchedBy: "name",
      code: matched.client.code,
      num: null,
      title: remainder.trim(),
      confidence: "medium"
    };
  }

  // ── Step 3: Total miss. Surface the FALLBACK parse if it caught a code, but mark as none
  // (per spec: skip+flag when there's no num to validate the prefix is actually a client).
  return {
    clientId: null,
    matchedBy: "none",
    code: null,
    num: null,
    title: trimmed,
    confidence: "low"
  };
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test tests/unit/bc2-client-resolver.test.ts`
Expected: All tests PASS.

If any test fails, read the failure message carefully. The most likely causes:
- `stripMatchedPrefix` returning the wrong substring for a particular input (test it manually)
- Normalization edge cases (e.g., en-dash `–` is not stripped by `[\s\-_.]` since the dash class only covers ASCII `-`)

If en-dash handling is needed, extend `normalize` to also strip `–`. The fixtures don't currently exercise en-dash titles, so this only matters if it surfaces in real data later.

- [ ] **Step 3: Run all unit tests as a regression check**

Run: `pnpm test`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/imports/bc2-client-resolver.ts
git commit -m "feat(bc2): client resolver with normalized prefix lookup"
```

---

## Task 7: Schema migration

**Files:**
- Create: `supabase/migrations/0028_relax_project_identity_constraints.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/0028_relax_project_identity_constraints.sql
-- Allow projects without an assigned identity (no-code path) and let
-- variant projects share project_seq. project_code remains the unique
-- identity guard.

alter table projects
  alter column project_code drop not null,
  alter column project_seq drop not null,
  alter column client_slug drop not null,
  alter column project_slug drop not null,
  alter column storage_project_dir drop not null;

-- Variant projects (MMR-049A, MMR-049B, ...) share project_seq=49 by design.
-- The unique guard moves entirely to project_code.
drop index if exists idx_projects_client_seq_unique;
```

- [ ] **Step 2: Sanity-check migration order**

Run: `ls supabase/migrations/ | tail -5`
Expected: `0028_relax_project_identity_constraints.sql` is the last entry alphabetically.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_relax_project_identity_constraints.sql
git commit -m "feat(db): relax project identity constraints for BC2 remediation"
```

This migration is NOT applied yet. It's applied during Task 13 (test environment bootstrap).

---

## Task 8: Seed-clients-from-prod script

**Files:**
- Create: `scripts/seed-clients-from-prod.ts`

Idempotent script that copies the 125 client rows from production to the test DB. Required so the resolver has the full client catalog at migration time.

- [ ] **Step 1: Create the script**

```ts
#!/usr/bin/env npx tsx
// scripts/seed-clients-from-prod.ts

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool } from "pg";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

interface ClientRow {
  id: string;
  code: string;
  name: string;
}

async function main() {
  const prodUrl = requireEnv("PROD_DATABASE_URL");
  const targetUrl = requireEnv("DATABASE_URL");

  if (prodUrl === targetUrl) {
    console.error("PROD_DATABASE_URL must NOT equal DATABASE_URL — refusing to seed onto production.");
    process.exit(1);
  }

  const prod = new Pool({ connectionString: prodUrl });
  const target = new Pool({ connectionString: targetUrl });

  process.stdout.write("Fetching clients from production...\n");
  const prodRes = await prod.query<ClientRow>("select id, code, name from clients order by code");
  process.stdout.write(`  ${prodRes.rows.length} clients fetched\n`);

  let inserted = 0;
  let skipped = 0;
  for (const row of prodRes.rows) {
    const exists = await target.query<{ id: string }>(
      "select id from clients where lower(code) = lower($1) limit 1",
      [row.code]
    );
    if (exists.rows.length > 0) {
      skipped++;
      continue;
    }
    await target.query(
      "insert into clients (id, code, name) values ($1, $2, $3)",
      [row.id, row.code, row.name]
    );
    inserted++;
  }

  await prod.end();
  await target.end();

  process.stdout.write(`\nDone. Inserted: ${inserted}, Skipped (already exist): ${skipped}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-clients-from-prod.ts
git commit -m "feat(bc2): add seed-clients-from-prod script for test env"
```

The script is NOT run yet. It runs during Task 13.

---

## Task 9: Migrator — pre-fetch known clients + resolver wiring

**Files:**
- Modify: `scripts/migrate-bc2.ts`

This task adds the pre-fetch and swaps `parseProjectTitle` for `resolveTitle`, but does NOT yet implement the new branching logic. After this task, the migrator behavior should be **functionally equivalent** to before (resolver returning `matchedBy: "code"` with a known client should produce the same `client.code` as the existing `resolveClientId` flow).

- [ ] **Step 1: Read the current `runProjectsImport` function**

Read `scripts/migrate-bc2.ts` lines 190-330 to see the project-import loop. Identify:
- The line that calls `parseProjectTitle(bc2Project.name)` (around line 233)
- The line that calls `resolveClientId(code)` (around line 240)

- [ ] **Step 2: Add `KnownClient` import and pre-fetch helper**

In `scripts/migrate-bc2.ts`, near the top imports section, add:

```ts
import { resolveTitle, type KnownClient } from "../lib/imports/bc2-client-resolver";
```

Then, near the other helper functions (above `runProjectsImport`), add:

```ts
async function fetchKnownClients(): Promise<KnownClient[]> {
  const r = await query<{ id: string; code: string; name: string }>(
    "select id, code, name from clients order by code"
  );
  return r.rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
}
```

- [ ] **Step 3: Call pre-fetch at the start of `runProjectsImport`**

At the top of `runProjectsImport`, immediately after the `process.stdout.write("Fetching projects...\n")` line, add:

```ts
  const knownClients = await fetchKnownClients();
  process.stdout.write(`Pre-fetched ${knownClients.length} known clients for resolver\n`);
```

- [ ] **Step 4: Replace the parser call**

Find this section (around line 233):

```ts
      const { code, num, title } = parseProjectTitle(bc2Project.name);
```

Replace with:

```ts
      const resolved = resolveTitle(bc2Project.name, knownClients);
      const { code, num, title } = resolved;
```

This is a pure rename + extra fields available, no behavior change yet — `code`, `num`, `title` keep the same shape. The `clientId` field on `resolved` is currently unused.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "refactor(migrate-bc2): pre-fetch clients, swap parser for resolver"
```

---

## Task 10: Migrator — branch on `matchedBy` outcome

**Files:**
- Modify: `scripts/migrate-bc2.ts`

Change the project-import loop to handle each `matchedBy` outcome differently. This task introduces real behavior changes.

- [ ] **Step 1: Read current resolveClientId usage**

Around lines 240-265 of `scripts/migrate-bc2.ts`, locate the existing flow:

```ts
      let clientId: string | null = null;
      let clientCode = "GEN";
      let clientSlug = "unassigned";
      if (code) {
        clientId = await resolveClientId(code);
        // ... clientRow lookup, clientSlug derivation
      }

      // project_seq logic
      let projectSeq: number;
      if (num) {
        projectSeq = parseInt(num, 10);
      } else {
        // grab next_seq
      }

      const projectCode = `${clientCode}-${String(projectSeq).padStart(4, "0")}`;
```

Note the precise lines and surrounding context — the next changes assume this shape.

- [ ] **Step 2: Replace the client-resolution + project_code section**

Replace the section from `let clientId: string | null = null;` through the line that builds `const projectCode = ...` with:

```ts
      // Resolved by Bc2ClientResolver: matchedBy ∈ {"code", "name", "auto-create-pending", "none"}
      let clientId: string | null = null;
      let clientCode = "GEN";
      let clientSlug = "unassigned";

      if (resolved.matchedBy === "code" || resolved.matchedBy === "name") {
        // Resolver matched a known client. Use its canonical code.
        clientId = resolved.clientId;
        clientCode = resolved.code ?? "GEN";
        const clientRow = await query<{ name: string }>(
          "select name from clients where id = $1",
          [clientId]
        );
        if (clientRow.rows[0]) {
          clientSlug = slugify(clientRow.rows[0].name);
        }
      } else if (resolved.matchedBy === "auto-create-pending") {
        // Clean code+num parse, code unknown. Auto-create new client.
        const newCode = (resolved.autoCreatePrefix ?? code ?? "UNKNOWN").replace(/[\s\-_.]/g, "");
        const newName = (resolved.autoCreatePrefix ?? code ?? "Unknown").trim();
        // resolveClientId is the existing helper that creates if missing (see lib/imports/bc2-transformer.ts).
        clientId = await resolveClientId(newCode);
        // Update the auto-created client's name to the original prefix (resolveClientId uses code as name).
        await query(
          "update clients set name = $1 where id = $2 and name = $3",
          [newName, clientId, newCode]
        );
        clientCode = newCode;
        clientSlug = slugify(newName);
        process.stdout.write(`  auto-created client: ${newCode} (${newName}) for bc2 ${bc2Project.id}\n`);
      } else {
        // matchedBy === "none". No code, no recognizable client. Orphan path.
        // If --allow-orphans is set, insert with NULL client_id and NULL project_code.
        // Otherwise, skip + emit to orphan CSV (handled in Task 12).
        if (!flags.allowOrphans) {
          orphans.push({ bc2Id: bc2Project.id, name: bc2Project.name, archived: bc2Project.archived === true, createdAt: bc2Project.created_at });
          process.stderr.write(`  skipped orphan: bc2 ${bc2Project.id} "${bc2Project.name}"\n`);
          continue;
        }
        clientId = null;
        clientCode = "";
        clientSlug = "unassigned";
      }

      // project_seq logic — variants share seq (the integer prefix of num).
      let projectSeq: number | null = null;
      if (num) {
        const numPrefixMatch = num.match(/^(\d+)/);
        projectSeq = numPrefixMatch ? parseInt(numPrefixMatch[1], 10) : null;
      } else if (clientId !== null) {
        const seqRow = await query<{ next_seq: number }>(
          "select coalesce(max(project_seq), 0) + 1 as next_seq from projects where client_id is not distinct from $1",
          [clientId]
        );
        projectSeq = seqRow.rows[0]?.next_seq ?? null;
      }

      // Build project_code. With suffixed-num support, num is the full string ("0042b", "049A").
      // Dup disambiguation suffix is added by Task 11's pre-pass via dupSuffixMap.
      const baseProjectCode = clientId !== null && num
        ? `${clientCode}-${num}`
        : null;
      const dupSuffix = baseProjectCode ? (dupSuffixMap.get(String(bc2Project.id)) ?? "") : "";
      const projectCode = baseProjectCode ? `${baseProjectCode}${dupSuffix}` : null;
```

- [ ] **Step 3: Update downstream references that assumed `projectCode` is non-null**

Find references to `projectCode` and `projectSeq` in the surrounding code (lines 268-300 area). Wrap any that assume non-null:

```ts
      // OLD:  const folderName = `${projectCode}-${sanitizeDropboxFolderTitle(title)}`;
      // NEW:
      const folderName = projectCode
        ? `${projectCode}-${sanitizeDropboxFolderTitle(title)}`
        : `_NoCode_${bc2Project.id}-${sanitizeDropboxFolderTitle(title)}`;

      // OLD:  const urlSlug = projectCode.toLowerCase();
      // NEW:
      const urlSlug = projectCode
        ? projectCode.toLowerCase()
        : `${slugify(title)}-bc2-${bc2Project.id}`;
```

For the storage path:

```ts
      // OLD:
      // const storageProjectDir = bc2Project.archived
      //   ? `${projectsRoot}/${clientCode}/_Archive/${folderName}`
      //   : `${projectsRoot}/${clientCode}/${folderName}`;
      // NEW (handles empty clientCode for total orphans):
      const clientFolder = clientCode || "_NoClient";
      const storageProjectDir = bc2Project.archived
        ? `${projectsRoot}/${clientFolder}/_Archive/${folderName}`
        : `${projectsRoot}/${clientFolder}/${folderName}`;
```

For the `INSERT … ON CONFLICT (project_code)` upsert: since NULL project_codes can no longer act as a conflict key (NULL ≠ NULL), the upsert becomes inert when project_code is null — which is correct. The `import_map_projects` table is the real idempotency key (an existing `select local_project_id from import_map_projects where basecamp_project_id = $1` check happens earlier in the loop). No further change needed here, BUT verify this by reading the existing flow.

- [ ] **Step 4: Add an `orphans` array at the top of `runProjectsImport`**

Near the top of `runProjectsImport`, before the `for await` loop, add:

```ts
  interface OrphanRow {
    bc2Id: number;
    name: string;
    archived: boolean;
    createdAt: string;
  }
  const orphans: OrphanRow[] = [];
```

(`orphans` is consumed in Task 12, where the CSV writer is added.)

- [ ] **Step 5: Add `dupSuffixMap` placeholder at the top of `runProjectsImport`**

Add:

```ts
  // Built by Task 11's pre-pass. For now, an empty map (no suffix added).
  const dupSuffixMap: Map<string, string> = new Map();
```

- [ ] **Step 6: Add `--allow-orphans` flag to CLI parsing**

Find the `parseFlags` function in `scripts/migrate-bc2.ts`. In the `CliFlags` interface, add:

```ts
  allowOrphans: boolean;
```

In `parseFlags()`, add to the returned object:

```ts
    allowOrphans: args.includes("--allow-orphans"),
```

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat(migrate-bc2): branch on resolver matchedBy outcome"
```

---

## Task 11: Migrator — duplicate disambiguation pre-pass

**Files:**
- Modify: `scripts/migrate-bc2.ts`

Compute the dup-suffix map BEFORE the per-project loop runs. Algorithm: collect all BC2 projects that resolve to the same `(clientCode, num)`; sort by `created_at` ASC; first keeps bare, rest get `a`, `b`, `c`, …

- [ ] **Step 1: Add pre-pass helper function**

Near the other helpers in `scripts/migrate-bc2.ts`, add:

```ts
interface PrePassEntry {
  bc2Id: string;
  createdAt: string;
  baseKey: string;
}

function planDupSuffixes(entries: PrePassEntry[]): Map<string, string> {
  const groups = new Map<string, PrePassEntry[]>();
  for (const e of entries) {
    if (!e.baseKey) continue;
    const list = groups.get(e.baseKey) ?? [];
    list.push(e);
    groups.set(e.baseKey, list);
  }

  const suffixMap = new Map<string, string>();
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sorted[0]; // first keeps bare (no entry written)
    for (let i = 1; i < sorted.length; i++) {
      const suffix = i <= 26 ? String.fromCharCode("a".charCodeAt(0) + i - 1) : `a${i - 1}`;
      suffixMap.set(sorted[i].bc2Id, suffix);
    }
  }
  return suffixMap;
}
```

- [ ] **Step 2: Run the pre-pass before the project loop**

In `runProjectsImport`, after `knownClients` is fetched and BEFORE the `for await (const bc2Project of fetcher.fetchProjects(...))` loop runs, replace the placeholder `dupSuffixMap` declaration:

```ts
  // OLD:
  // const dupSuffixMap: Map<string, string> = new Map();
  // NEW:
  process.stdout.write("Pre-pass: collecting projects for dup disambiguation...\n");
  const prePassEntries: PrePassEntry[] = [];
  // We need to fetch projects TWICE (once for pre-pass, once for actual import) since the
  // generator is single-use. Simplest: collect everything to an array first, then iterate.
  const allBc2Projects: Bc2Project[] = [];
  for await (const p of fetcher.fetchProjects({ source: flags.projectSource })) {
    allBc2Projects.push(p);
    const resolved = resolveTitle(p.name, knownClients);
    if ((resolved.matchedBy === "code" || resolved.matchedBy === "name") && resolved.code && resolved.num) {
      prePassEntries.push({
        bc2Id: String(p.id),
        createdAt: p.created_at,
        baseKey: `${resolved.code}|${resolved.num}`
      });
    }
  }
  const dupSuffixMap = planDupSuffixes(prePassEntries);
  process.stdout.write(`Pre-pass: ${dupSuffixMap.size} duplicates assigned suffixes\n`);
```

- [ ] **Step 3: Replace the streaming loop with array iteration**

Find the existing project-import loop:

```ts
  for await (const bc2Project of fetcher.fetchProjects({ source: flags.projectSource })) {
    // ... per-project logic
  }
```

Change to iterate the pre-fetched array:

```ts
  for (const bc2Project of allBc2Projects) {
    // ... per-project logic (unchanged otherwise)
  }
```

This means the migrator now buffers the full project list in memory before importing. With 3691 projects and only `{id, name, archived, created_at, ...}` per project, this is ~1MB — acceptable.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat(migrate-bc2): dup disambiguation pre-pass with a/b/c suffixes"
```

---

## Task 12: Migrator — orphan CSV + summary JSON output

**Files:**
- Modify: `scripts/migrate-bc2.ts`

After the project loop completes, write `tmp/bc2-import-orphans.csv` and `tmp/bc2-import-summary.json`.

- [ ] **Step 1: Add a summary accumulator at the top of `runProjectsImport`**

Near the `orphans` declaration, add:

```ts
  const summary = {
    matchedBy: { code: 0, name: 0, "auto-create-pending": 0, none: 0 } as Record<string, number>,
    autoCreatedClients: [] as Array<{ code: string; name: string; bc2Id: number }>,
    dupSuffixesAssigned: 0
  };
```

- [ ] **Step 2: Increment counters during the loop**

Inside the project-import loop, after `const resolved = resolveTitle(...)` is computed, add:

```ts
      summary.matchedBy[resolved.matchedBy] = (summary.matchedBy[resolved.matchedBy] ?? 0) + 1;
```

Inside the `else if (resolved.matchedBy === "auto-create-pending")` branch, after `process.stdout.write("...auto-created...")`, add:

```ts
        summary.autoCreatedClients.push({ code: newCode, name: newName, bc2Id: bc2Project.id });
```

After the `dupSuffixMap` is built (in Task 11's section), add:

```ts
  summary.dupSuffixesAssigned = dupSuffixMap.size;
```

- [ ] **Step 3: Write CSV + JSON at the end of `runProjectsImport`**

Add at the very end of `runProjectsImport`, after the existing summary printout (look for `process.stdout.write(\`  ${pad...projects.length`)} ...\`)`):

```ts
  // ── Write orphan CSV + summary JSON ──
  const fs = await import("fs/promises");
  const path = await import("path");
  const tmpDir = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const csvEsc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const orphanLines = ["bc2_id,raw_title,archived,created_at"];
  for (const o of orphans) {
    orphanLines.push([String(o.bc2Id), csvEsc(o.name), String(o.archived), o.createdAt].join(","));
  }
  const orphanPath = path.join(tmpDir, "bc2-import-orphans.csv");
  await fs.writeFile(orphanPath, orphanLines.join("\n") + "\n", "utf-8");

  const summaryOut = {
    generated_at: new Date().toISOString(),
    total_bc2_projects: allBc2Projects.length,
    matched_by: summary.matchedBy,
    auto_created_clients: summary.autoCreatedClients,
    dup_suffixes_assigned: summary.dupSuffixesAssigned,
    orphans_count: orphans.length,
    orphan_csv: orphanPath
  };
  const summaryPath = path.join(tmpDir, "bc2-import-summary.json");
  await fs.writeFile(summaryPath, JSON.stringify(summaryOut, null, 2), "utf-8");

  process.stdout.write(`\nWrote orphans CSV (${orphans.length} rows): ${orphanPath}\n`);
  process.stdout.write(`Wrote import summary: ${summaryPath}\n`);
```

- [ ] **Step 4: Add summary outputs to gitignore**

Read `.gitignore`. Append (preserving all existing lines):

```
tmp/bc2-import-orphans.csv
tmp/bc2-import-summary.json
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run unit tests as regression check**

Run: `pnpm test`
Expected: all tests PASS (the migrator script isn't unit-tested but classifier + transformer + resolver tests should all still pass).

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-bc2.ts .gitignore
git commit -m "feat(migrate-bc2): emit orphan CSV + import summary JSON"
```

---

## Task 13: Test environment bootstrap

**Files:**
- (None — this task runs commands against the test Supabase project)

Apply migrations to the test project + seed clients. Requires the user to confirm the Supabase MCP is authenticated OR provide the test `DATABASE_URL` for direct CLI access.

- [ ] **Step 1: Confirm test-env env file exists**

Ask the user to create `.env.test.local` at the project root with:

```
DATABASE_URL=postgresql://...   # test project (anrnlmmanhrddkvrnooe) connection string
PROD_DATABASE_URL=postgresql://...  # current production URL (used only by seed-clients-from-prod)
DROPBOX_PROJECTS_ROOT_FOLDER=/Projects-test
BASECAMP_ACCOUNT_ID=...   # same as production
BASECAMP_USERNAME=...     # same as production
BASECAMP_PASSWORD=...     # same as production
BASECAMP_USER_AGENT=...   # same as production
```

The migrator script reads `.env.local` (not `.env.test.local`). Workflow: temporarily symlink or copy `.env.test.local` → `.env.local` for the duration of test runs. Restore production `.env.local` when done.

```
cp .env.local .env.local.prod-backup
cp .env.test.local .env.local
```

(Restore at end: `mv .env.local.prod-backup .env.local`.)

- [ ] **Step 2: Apply all migrations to the test project**

Two paths — choose based on what's available:

**Path A: Via Supabase MCP** (if authenticated; check with the user). Use the MCP's apply-migration tool to run each `.sql` file in `supabase/migrations/` in order. This will include the new `0028_relax_project_identity_constraints.sql`. Confirm success after each.

**Path B: Via Supabase CLI** (if `supabase` CLI is installed and the project is linked). Run:

```
supabase link --project-ref anrnlmmanhrddkvrnooe
supabase db push
```

If neither path works, escalate to the user — this is a manual setup step.

Expected: all 28 migrations applied with no errors.

- [ ] **Step 3: Sanity-check schema landed**

If using MCP: query the test DB:

```sql
select column_name, is_nullable
from information_schema.columns
where table_name = 'projects'
  and column_name in ('project_code', 'project_seq', 'client_slug', 'project_slug', 'storage_project_dir');
```

Expected: all five columns show `is_nullable = YES`.

```sql
select indexname from pg_indexes
where tablename = 'projects' and indexname = 'idx_projects_client_seq_unique';
```

Expected: 0 rows (index dropped).

If using direct DB access via `psql` or `pg`: same queries.

- [ ] **Step 4: Seed clients from production**

Run:

```
npx tsx scripts/seed-clients-from-prod.ts
```

Expected: prints `Inserted: 125, Skipped: 0` (or similar — exact count depends on production at the moment).

- [ ] **Step 5: Verify client count**

Query the test DB:

```sql
select count(*) from clients;
```

Expected: ~125 (the 125 production clients).

- [ ] **Step 6: No commit for this task**

This task does not produce git changes — only environmental state. Mark it complete after all steps succeed.

---

## Task 14: End-to-end migration run + verification

**Files:**
- (None — runs commands against test environment)

Run the migrator end-to-end on the test project. Verify outcomes match expectations from the audit.

- [ ] **Step 1: Confirm `.env.local` points at test project**

Run: `grep -E '^DATABASE_URL|^DROPBOX_PROJECTS_ROOT_FOLDER' .env.local`
Expected: `DATABASE_URL` matches the test project's URL; `DROPBOX_PROJECTS_ROOT_FOLDER` is the sandbox folder (e.g., `/Projects-test`).

If not, swap the env file (per Task 13 Step 1).

- [ ] **Step 2: Run the migrator (full mode, no files)**

To save time on the first end-to-end run, skip file imports. Files are tested in a follow-up run.

```
npx tsx scripts/migrate-bc2.ts --mode=full --projects=all
```

Expected: ~3691 projects processed. Console prints per-project progress and ends with summary lines pointing at `tmp/bc2-import-orphans.csv` and `tmp/bc2-import-summary.json`.

- [ ] **Step 3: Inspect the summary**

Run: `cat tmp/bc2-import-summary.json`

Compare to expectations from the audit:

| Outcome | Audit-derived expectation |
|---|---|
| matched_by.code | ~3500+ (clean + clean-3digit-num + most prefix-noise + most fallback-no-num + suffixed-num) |
| matched_by.name | ~30-100 (no-code rows that match a known client name as prefix) |
| matched_by["auto-create-pending"] | ~10 (Merrill Lynch, Rainbow to Heaven, EcoTech, etc.) |
| matched_by.none | ~30-50 (truly orphan no-code rows) |
| dup_suffixes_assigned | ~60 (one per dup group) |
| orphans_count | matches `matched_by.none` |
| auto_created_clients | ~10 entries with code/name |

Significant deviations from these ranges (e.g., `matched_by.none` over 100) indicate the resolver isn't matching as well as the research predicted — investigate before continuing.

- [ ] **Step 4: Spot-check via app**

Start the dev server:

```
pnpm dev
```

Visit:

1. A `prefix-noise`-recovered project — find one in `bc2-import-summary.json`'s auto-created list or query the DB for a `project_code` starting with `CalLPF-`. Confirm the project page renders, breadcrumb shows `CalLPF-NNN - Title`, client_id is `CalLPF`'s id.

2. A `suffixed-num` project — query for a `project_code` like `MMR-049A` or `JFLA-188a`. Confirm the project page renders with full code preserved.

3. A `no-code` project (matched by name) — query for a project with `client_id` set but `project_code IS NULL`. Confirm the project page renders, breadcrumb shows just the name, no broken layout.

4. A duplicate group — `MON-458` should have one bare and one suffixed-`a` project. Both load. Distinct slugs, distinct Dropbox folder names.

If any spot-check fails:
- Read the failure carefully (404 on a slug? Broken breadcrumb? Wrong client?)
- Determine if it's a code bug (in the migrator, resolver, or read path) or a data bug (resolver matched wrong client)
- Report findings — DO NOT modify production code without escalating

- [ ] **Step 5: Re-run with `--files` if the no-files run looks good**

```
npx tsx scripts/migrate-bc2.ts --mode=full --projects=all --files
```

This pulls BC2 attachments and uploads to the sandbox Dropbox folder. Expect a much longer run (hours, given file sizes).

Confirm files appear under `/Projects-test/{client}/{project}/...` in Dropbox.

- [ ] **Step 6: No commit for this task**

This task verifies behavior, doesn't change code. Mark complete after spot-checks pass.

If issues surface, file follow-up tasks (do NOT auto-commit fixes).

---

## Self-Review Checklist (executed inline)

**Spec coverage:**

- §1 Parser regex relax → Tasks 1, 2 ✓
- §2 Client resolver module → Tasks 4, 5, 6 ✓
- §3a Pre-fetch known clients → Task 9 ✓
- §3b Per-project resolution branching → Task 10 ✓
- §3c Suffixed-num path → Task 10 (project_seq integer-prefix logic) ✓
- §3d Dup disambiguation pre-pass → Task 11 ✓
- §4 Schema migration → Task 7 (file created), Task 13 (applied) ✓
- §5a Capture connection string → Task 13 step 1 ✓
- §5b Apply migrations → Task 13 step 2 ✓
- §5c Seed clients → Task 8 (script), Task 13 step 4 (run) ✓
- §5d Dropbox sandbox folder → Task 13 step 1 (in env file) ✓
- §5e Run migrator → Task 14 ✓
- §5f Re-run audit on imported data → out-of-scope per spec; not in this plan ✓
- §5g Ad-hoc inspection via MCP → Task 13 step 3 + Task 14 step 3 ✓
- Orphan CSV + summary JSON → Task 12 ✓
- `--allow-orphans` flag → Task 10 step 6 ✓
- Drift guard test still passes → Task 3 ✓

**Placeholder scan:** No "TBD", "TODO", "implement later". Each step has full code or specific commands.

**Type consistency:** `KnownClient`, `ResolvedTitle`, `MatchedBy`, `Confidence` defined in Task 4, used identically in Tasks 5, 6, 9, 10, 11, 12. `OrphanRow` declared in Task 10 step 4, consumed in Task 12 step 3. `PrePassEntry` declared in Task 11.

**Known soft spot:** Task 14 verification depends on the user having access to a working dev server and Dropbox sandbox folder. If those aren't available, the verification reduces to schema + summary inspection only — flag this limitation when reporting back.

No issues found. Plan is ready for execution.
