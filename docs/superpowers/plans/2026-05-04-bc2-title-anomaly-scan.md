# BC2 Title Anomaly Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-shot diagnostic that fetches every BC2 project title (active + archived), classifies each by anomaly type, and writes CSV + JSON reports for human triage.

**Architecture:** Two scripts plus one pure module. `scripts/dump-bc2-titles.ts` fetches BC2 → `tmp/bc2-titles.json`. `lib/imports/bc2-title-classifier.ts` is a pure classifier. `scripts/audit-bc2-titles.ts` reads the dump, classifies each row, runs cross-row duplicate detection, writes `tmp/bc2-title-audit.{csv,json}` + stdout summary. A drift-guard unit test asserts classifier `clean` rows still parse via the live `parseProjectTitle`.

**Tech Stack:** TypeScript, Node 24, vitest, existing `Bc2Fetcher`/`Bc2Client` infra, `pg` (only if `--clients-from-db` used).

**Spec:** `docs/superpowers/specs/2026-05-04-bc2-title-anomaly-scan-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/imports/bc2-fetcher.ts` | Modify | Export the existing `Bc2Project` interface so dump script can type its projection |
| `lib/imports/bc2-title-classifier.ts` | Create | Pure classifier — `classifyTitle(raw)` and shared types. No IO, no DB |
| `tests/unit/bc2-title-classifier.test.ts` | Create | Unit tests per primary class + per flag + drift guard against `parseProjectTitle` |
| `scripts/dump-bc2-titles.ts` | Create | Fetch BC2 projects, project to `{id, name, archived, created_at}`, atomic write to `tmp/bc2-titles.json` |
| `scripts/audit-bc2-titles.ts` | Create | Read dump, classify, dedupe, write CSV + JSON, print summary |
| `.gitignore` | Modify | Ignore `tmp/bc2-titles.json`, `tmp/bc2-title-audit.csv`, `tmp/bc2-title-audit.json` |

---

## Task 1: Export `Bc2Project` interface

**Files:**
- Modify: `lib/imports/bc2-fetcher.ts:14`

The `Bc2Project` interface is currently un-exported. The dump script needs the type. One-line change.

- [ ] **Step 1: Add `export` keyword**

In `lib/imports/bc2-fetcher.ts`, change:

```ts
interface Bc2Project {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
```

to:

```ts
export interface Bc2Project {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Run typecheck to confirm no break**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add lib/imports/bc2-fetcher.ts
git commit -m "refactor(bc2): export Bc2Project type for downstream scripts"
```

---

## Task 2: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

Audit outputs go in `tmp/`. Ensure they don't get committed.

- [ ] **Step 1: Append patterns**

Append these lines to `.gitignore` (do not overwrite existing entries):

```
tmp/bc2-titles.json
tmp/bc2-title-audit.csv
tmp/bc2-title-audit.json
```

- [ ] **Step 2: Verify**

Run: `git check-ignore tmp/bc2-titles.json tmp/bc2-title-audit.csv tmp/bc2-title-audit.json`
Expected: all three paths echoed back (ignored).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore BC2 title audit outputs"
```

---

## Task 3: Define classifier types and skeleton

**Files:**
- Create: `lib/imports/bc2-title-classifier.ts`

Create the module with types and an empty `classifyTitle` that returns `empty-raw` for everything. Tests come next, then real logic. Keeps each step bite-sized.

- [ ] **Step 1: Create the file**

```ts
// lib/imports/bc2-title-classifier.ts

export type PrimaryClass =
  | "empty-raw"
  | "empty-title"
  | "clean"
  | "clean-3digit-num"
  | "suffixed-num"
  | "short-num"
  | "long-num"
  | "missing-colon"
  | "prefix-noise"
  | "fallback-no-num"
  | "no-code";

export type Flag =
  | "lowercase-code"
  | "en-dash-separator"
  | "non-ascii"
  | "leading-trailing-ws"
  | "colon-in-title"
  | "unknown-client-code"
  | "duplicate-code-num";

export interface Classification {
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

export function classifyTitle(raw: string | null | undefined): Classification {
  return {
    primaryClass: "empty-raw",
    flags: [],
    code: null,
    num: null,
    parsedTitle: ""
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/bc2-title-classifier.ts
git commit -m "feat(bc2): scaffold title classifier module"
```

---

## Task 4: Test fixture list (TDD red phase)

**Files:**
- Create: `tests/unit/bc2-title-classifier.test.ts`

Write the full fixture-driven test suite first. All tests should fail because the classifier is a stub.

- [ ] **Step 1: Write the test file**

```ts
// tests/unit/bc2-title-classifier.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyTitle,
  type PrimaryClass,
  type Flag
} from "@/lib/imports/bc2-title-classifier";
import { parseProjectTitle } from "@/lib/imports/bc2-transformer";

interface Fixture {
  raw: string | null | undefined;
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

const fixtures: Fixture[] = [
  // empty-raw
  { raw: "", primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" },
  { raw: "   ", primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" },
  { raw: null, primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" },
  { raw: undefined, primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" },

  // empty-title
  { raw: "GX-0042:", primaryClass: "empty-title", flags: [], code: "GX", num: "0042", parsedTitle: "" },
  { raw: "GX-0042:   ", primaryClass: "empty-title", flags: [], code: "GX", num: "0042", parsedTitle: "" },

  // clean
  { raw: "GX-0042: Brand refresh", primaryClass: "clean", flags: [], code: "GX", num: "0042", parsedTitle: "Brand refresh" },
  { raw: "JFLA-1414: Invitation Graphic", primaryClass: "clean", flags: [], code: "JFLA", num: "1414", parsedTitle: "Invitation Graphic" },

  // clean-3digit-num
  { raw: "GX-042: Brand refresh", primaryClass: "clean-3digit-num", flags: [], code: "GX", num: "042", parsedTitle: "Brand refresh" },

  // suffixed-num (cascade bug)
  { raw: "GX-0042b: Variant brand refresh", primaryClass: "suffixed-num", flags: [], code: "GX", num: "0042b", parsedTitle: "Variant brand refresh" },
  { raw: "GX-0042a: Variant", primaryClass: "suffixed-num", flags: [], code: "GX", num: "0042a", parsedTitle: "Variant" },

  // short-num
  { raw: "GX-12: Foo", primaryClass: "short-num", flags: [], code: "GX", num: "12", parsedTitle: "Foo" },
  { raw: "GX-7: Bar", primaryClass: "short-num", flags: [], code: "GX", num: "7", parsedTitle: "Bar" },

  // long-num
  { raw: "GX-12345: Foo", primaryClass: "long-num", flags: [], code: "GX", num: "12345", parsedTitle: "Foo" },

  // missing-colon
  { raw: "GX-0042 Foo", primaryClass: "missing-colon", flags: [], code: "GX", num: "0042", parsedTitle: "Foo" },

  // prefix-noise
  { raw: "[ARCHIVED] GX-0042: Foo", primaryClass: "prefix-noise", flags: [], code: "GX", num: "0042", parsedTitle: "Foo" },

  // fallback-no-num
  { raw: "GX - Foo", primaryClass: "fallback-no-num", flags: [], code: "GX", num: null, parsedTitle: "Foo" },
  { raw: "POMS - Website Software Update", primaryClass: "fallback-no-num", flags: [], code: "POMS", num: null, parsedTitle: "Website Software Update" },

  // no-code
  { raw: "Foo Bar Project", primaryClass: "no-code", flags: [], code: null, num: null, parsedTitle: "Foo Bar Project" },
  { raw: "123 Main St", primaryClass: "no-code", flags: [], code: null, num: null, parsedTitle: "123 Main St" },

  // flags: lowercase-code
  { raw: "gx-0042: Foo", primaryClass: "clean", flags: ["lowercase-code"], code: "gx", num: "0042", parsedTitle: "Foo" },

  // flags: en-dash-separator
  { raw: "GX – Foo", primaryClass: "fallback-no-num", flags: ["en-dash-separator"], code: "GX", num: null, parsedTitle: "Foo" },

  // flags: non-ascii
  { raw: "GX-0042: Café redesign", primaryClass: "clean", flags: ["non-ascii"], code: "GX", num: "0042", parsedTitle: "Café redesign" },

  // flags: leading-trailing-ws
  { raw: "  GX-0042: Foo  ", primaryClass: "clean", flags: ["leading-trailing-ws"], code: "GX", num: "0042", parsedTitle: "Foo" },

  // flags: colon-in-title
  { raw: "GX-0042: Phase 1: Discovery", primaryClass: "clean", flags: ["colon-in-title"], code: "GX", num: "0042", parsedTitle: "Phase 1: Discovery" },

  // stacked flags
  { raw: "  gx-0042: Café  ", primaryClass: "clean", flags: ["lowercase-code", "non-ascii", "leading-trailing-ws"], code: "gx", num: "0042", parsedTitle: "Café" }
];

describe("classifyTitle", () => {
  for (const f of fixtures) {
    const label = `[${f.primaryClass}${f.flags.length ? "+" + f.flags.join(",") : ""}] ${JSON.stringify(f.raw)}`;
    it(label, () => {
      const result = classifyTitle(f.raw);
      expect(result.primaryClass).toBe(f.primaryClass);
      expect([...result.flags].sort()).toEqual([...f.flags].sort());
      expect(result.code).toBe(f.code);
      expect(result.num).toBe(f.num);
      expect(result.parsedTitle).toBe(f.parsedTitle);
    });
  }
});

describe("drift guard: clean fixtures must parse via parseProjectTitle", () => {
  const cleanFixtures = fixtures.filter(
    (f) => f.primaryClass === "clean" || f.primaryClass === "clean-3digit-num"
  );
  for (const f of cleanFixtures) {
    it(`parseProjectTitle agrees on clean: ${JSON.stringify(f.raw)}`, () => {
      const parsed = parseProjectTitle(String(f.raw));
      // Code is case-insensitive in the source regex; compare lowercased
      expect(parsed.code?.toLowerCase()).toBe(f.code?.toLowerCase());
      expect(parsed.num).toBe(f.num);
      expect(parsed.title).toBe(f.parsedTitle);
    });
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test tests/unit/bc2-title-classifier.test.ts`
Expected: FAIL — most tests fail because stub returns `empty-raw` for everything.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/bc2-title-classifier.test.ts
git commit -m "test(bc2): add fixture-driven classifier test suite (red)"
```

---

## Task 5: Implement classifier — primary classes

**Files:**
- Modify: `lib/imports/bc2-title-classifier.ts`

Implement primary class detection in table order. Skip flag detection for now — fixtures with no flags should pass after this task.

- [ ] **Step 1: Replace `classifyTitle` with the real implementation**

Replace the body of `lib/imports/bc2-title-classifier.ts` (keep the type exports, add helpers and real logic):

```ts
// lib/imports/bc2-title-classifier.ts

export type PrimaryClass =
  | "empty-raw"
  | "empty-title"
  | "clean"
  | "clean-3digit-num"
  | "suffixed-num"
  | "short-num"
  | "long-num"
  | "missing-colon"
  | "prefix-noise"
  | "fallback-no-num"
  | "no-code";

export type Flag =
  | "lowercase-code"
  | "en-dash-separator"
  | "non-ascii"
  | "leading-trailing-ws"
  | "colon-in-title"
  | "unknown-client-code"
  | "duplicate-code-num";

export interface Classification {
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

// Mirror of parser regexes from lib/imports/bc2-transformer.ts (kept aligned via drift-guard test).
const PRIMARY = /^([A-Za-z]+)-(\d{3,4}):\s*(.*)$/;
const FALLBACK = /^([A-Za-z]+)\s*[-–]\s*(.+)$/;

const SUFFIXED_NUM = /^([A-Za-z]+)-(\d+[A-Za-z]+)(?::\s*(.*))?(?:\s|$)/;
const SHORT_NUM = /^([A-Za-z]+)-(\d{1,2})(?::\s*(.*)|\s+(.+))?(?:\s|$)/;
const LONG_NUM = /^([A-Za-z]+)-(\d{5,})(?::\s*(.*)|\s+(.+))?(?:\s|$)/;
const MISSING_COLON = /^([A-Za-z]+)-(\d{3,4})\s+(\S.*)$/;
const PREFIX_NOISE = /^.+?\b([A-Za-z]+)-(\d{3,4})(?::\s*(.*)|\s+(.+))?$/;

export function classifyTitle(raw: string | null | undefined): Classification {
  if (raw == null || String(raw).trim() === "") {
    return { primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" };
  }

  const trimmed = String(raw).trim();

  // PRIMARY
  const primary = trimmed.match(PRIMARY);
  if (primary) {
    const [, code, num, title] = primary;
    const titleTrim = title.trim();
    if (titleTrim === "") {
      return { primaryClass: "empty-title", flags: [], code, num, parsedTitle: "" };
    }
    const cls: PrimaryClass = num.length === 4 ? "clean" : "clean-3digit-num";
    return { primaryClass: cls, flags: [], code, num, parsedTitle: titleTrim };
  }

  // suffixed-num
  const suffixed = trimmed.match(SUFFIXED_NUM);
  if (suffixed) {
    const [, code, num, titleAfterColon] = suffixed;
    const parsedTitle = (titleAfterColon ?? trimmed.slice(suffixed[0].length)).trim();
    return { primaryClass: "suffixed-num", flags: [], code, num, parsedTitle };
  }

  // short-num
  const short = trimmed.match(SHORT_NUM);
  if (short) {
    const [, code, num, t1, t2] = short;
    const parsedTitle = (t1 ?? t2 ?? "").trim();
    return { primaryClass: "short-num", flags: [], code, num, parsedTitle };
  }

  // long-num
  const long = trimmed.match(LONG_NUM);
  if (long) {
    const [, code, num, t1, t2] = long;
    const parsedTitle = (t1 ?? t2 ?? "").trim();
    return { primaryClass: "long-num", flags: [], code, num, parsedTitle };
  }

  // missing-colon
  const missing = trimmed.match(MISSING_COLON);
  if (missing) {
    const [, code, num, title] = missing;
    return { primaryClass: "missing-colon", flags: [], code, num, parsedTitle: title.trim() };
  }

  // prefix-noise (code-num appears, not at position 0)
  const prefix = trimmed.match(PREFIX_NOISE);
  if (prefix && !trimmed.match(/^[A-Za-z]+-\d{3,4}/)) {
    const [, code, num, t1, t2] = prefix;
    return { primaryClass: "prefix-noise", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
  }

  // fallback-no-num
  const fb = trimmed.match(FALLBACK);
  if (fb) {
    const [, code, title] = fb;
    return { primaryClass: "fallback-no-num", flags: [], code, num: null, parsedTitle: title.trim() };
  }

  // no-code
  return { primaryClass: "no-code", flags: [], code: null, num: null, parsedTitle: trimmed };
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test tests/unit/bc2-title-classifier.test.ts`
Expected: All no-flag fixture tests PASS. Fixtures with flags still FAIL on the `flags` assertion (we add flag logic in Task 6). Drift-guard tests for `clean`/`clean-3digit-num` PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/bc2-title-classifier.ts
git commit -m "feat(bc2): classify titles by primary anomaly class"
```

---

## Task 6: Implement classifier — flags

**Files:**
- Modify: `lib/imports/bc2-title-classifier.ts`

Add flag detection on top of the primary class result.

- [ ] **Step 1: Add flag detection helpers and apply in `classifyTitle`**

In `lib/imports/bc2-title-classifier.ts`, add this helper above `classifyTitle`:

```ts
function detectFlags(
  raw: string,
  trimmed: string,
  code: string | null,
  parsedTitle: string,
  primaryClass: PrimaryClass
): Flag[] {
  const flags: Flag[] = [];

  if (code !== null && code !== code.toUpperCase()) {
    flags.push("lowercase-code");
  }

  if (/[–]/.test(trimmed)) {
    flags.push("en-dash-separator");
  }

  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(trimmed)) {
    flags.push("non-ascii");
  }

  if (raw !== trimmed) {
    flags.push("leading-trailing-ws");
  }

  if (
    (primaryClass === "clean" || primaryClass === "clean-3digit-num") &&
    parsedTitle.includes(":")
  ) {
    flags.push("colon-in-title");
  }

  return flags;
}
```

Then change every `return { primaryClass: ..., flags: [], ... }` at the end of each branch in `classifyTitle` to compute and set flags. Easiest pattern: have all branches build a `result` object, then set `result.flags = detectFlags(...)` once before returning.

Refactor the function body to:

```ts
export function classifyTitle(raw: string | null | undefined): Classification {
  if (raw == null || String(raw).trim() === "") {
    return { primaryClass: "empty-raw", flags: [], code: null, num: null, parsedTitle: "" };
  }

  const rawStr = String(raw);
  const trimmed = rawStr.trim();

  let result: Classification | null = null;

  // PRIMARY
  const primary = trimmed.match(PRIMARY);
  if (primary) {
    const [, code, num, title] = primary;
    const titleTrim = title.trim();
    if (titleTrim === "") {
      result = { primaryClass: "empty-title", flags: [], code, num, parsedTitle: "" };
    } else {
      const cls: PrimaryClass = num.length === 4 ? "clean" : "clean-3digit-num";
      result = { primaryClass: cls, flags: [], code, num, parsedTitle: titleTrim };
    }
  }

  if (!result) {
    const suffixed = trimmed.match(SUFFIXED_NUM);
    if (suffixed) {
      const [, code, num, titleAfterColon] = suffixed;
      const parsedTitle = (titleAfterColon ?? trimmed.slice(suffixed[0].length)).trim();
      result = { primaryClass: "suffixed-num", flags: [], code, num, parsedTitle };
    }
  }

  if (!result) {
    const short = trimmed.match(SHORT_NUM);
    if (short) {
      const [, code, num, t1, t2] = short;
      result = { primaryClass: "short-num", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
    }
  }

  if (!result) {
    const long = trimmed.match(LONG_NUM);
    if (long) {
      const [, code, num, t1, t2] = long;
      result = { primaryClass: "long-num", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
    }
  }

  if (!result) {
    const missing = trimmed.match(MISSING_COLON);
    if (missing) {
      const [, code, num, title] = missing;
      result = { primaryClass: "missing-colon", flags: [], code, num, parsedTitle: title.trim() };
    }
  }

  if (!result) {
    const prefix = trimmed.match(PREFIX_NOISE);
    if (prefix && !trimmed.match(/^[A-Za-z]+-\d{3,4}/)) {
      const [, code, num, t1, t2] = prefix;
      result = { primaryClass: "prefix-noise", flags: [], code, num, parsedTitle: (t1 ?? t2 ?? "").trim() };
    }
  }

  if (!result) {
    const fb = trimmed.match(FALLBACK);
    if (fb) {
      const [, code, title] = fb;
      result = { primaryClass: "fallback-no-num", flags: [], code, num: null, parsedTitle: title.trim() };
    }
  }

  if (!result) {
    result = { primaryClass: "no-code", flags: [], code: null, num: null, parsedTitle: trimmed };
  }

  result.flags = detectFlags(rawStr, trimmed, result.code, result.parsedTitle, result.primaryClass);
  return result;
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test tests/unit/bc2-title-classifier.test.ts`
Expected: All fixture tests PASS, drift-guard tests PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/bc2-title-classifier.ts
git commit -m "feat(bc2): detect flags (lowercase code, en-dash, non-ascii, ws, colon)"
```

---

## Task 7: Dump script — fetch titles to JSON

**Files:**
- Create: `scripts/dump-bc2-titles.ts`

Reuses existing `Bc2Client` + `Bc2Fetcher`. Title-only — no DB, no Dropbox. Atomic write.

- [ ] **Step 1: Create the script**

```ts
#!/usr/bin/env npx tsx
// scripts/dump-bc2-titles.ts

import { config } from "dotenv";
import { resolve, dirname } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, rename, writeFile } from "fs/promises";
import { Bc2Client } from "../lib/imports/bc2-client";
import { Bc2Fetcher, type Bc2Project, type Bc2ProjectSource } from "../lib/imports/bc2-fetcher";

interface CliFlags {
  source: Bc2ProjectSource;
  out: string;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=").slice(1).join("=") : null;
  };
  const rawSource = (get("source") ?? "all") as string;
  if (rawSource !== "active" && rawSource !== "archived" && rawSource !== "all") {
    console.error(`Unknown --source=${rawSource}. Use active | archived | all.`);
    process.exit(1);
  }
  return {
    source: rawSource as Bc2ProjectSource,
    out: get("out") ?? "tmp/bc2-titles.json"
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

interface DumpRecord {
  id: number;
  name: string;
  archived: boolean;
  created_at: string;
}

interface DumpFile {
  generated_at: string;
  source: Bc2ProjectSource;
  count: number;
  records: DumpRecord[];
}

async function main() {
  const flags = parseFlags();

  const accountId = requireEnv("BC2_ACCOUNT_ID");
  const accessToken = requireEnv("BC2_ACCESS_TOKEN");
  const userAgent = process.env.BC2_USER_AGENT ?? "basecamp-clone-title-dump";

  const client = new Bc2Client({ accountId, accessToken, userAgent });
  const fetcher = new Bc2Fetcher(client);

  process.stdout.write(`Fetching BC2 projects (source=${flags.source})...\n`);

  const records: DumpRecord[] = [];
  let warnCount = 0;

  for await (const p of fetcher.fetchProjects({ source: flags.source }) as AsyncGenerator<Bc2Project>) {
    if (typeof p.id !== "number" || typeof p.name !== "string") {
      warnCount++;
      process.stderr.write(`  warn: malformed record skipped: ${JSON.stringify(p)}\n`);
      continue;
    }
    records.push({
      id: p.id,
      name: p.name,
      archived: p.archived === true,
      created_at: p.created_at
    });
    if (records.length % 100 === 0) {
      process.stdout.write(`  ...${records.length} fetched\n`);
    }
  }

  const dump: DumpFile = {
    generated_at: new Date().toISOString(),
    source: flags.source,
    count: records.length,
    records
  };

  const outPath = resolve(process.cwd(), flags.out);
  const tmpPath = `${outPath}.tmp`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(dump, null, 2), "utf-8");
  await rename(tmpPath, outPath);

  process.stdout.write(`\nDone. ${records.length} records written to ${outPath}\n`);
  if (warnCount > 0) process.stdout.write(`Warnings: ${warnCount} malformed records skipped\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Smoke test (manual, optional)**

If BC2 creds are in `.env.local`, run:

```
pnpm exec tsx scripts/dump-bc2-titles.ts --source=active
```

Expected: writes `tmp/bc2-titles.json` with `{generated_at, source, count, records: [...]}`. Skip if creds unavailable — script is small and tested via type system + the next task's audit consumer.

- [ ] **Step 4: Commit**

```bash
git add scripts/dump-bc2-titles.ts
git commit -m "feat(bc2): add dump-bc2-titles script for title-only export"
```

---

## Task 8: Audit script — read, classify, dedupe, write outputs

**Files:**
- Create: `scripts/audit-bc2-titles.ts`

Reads dump, classifies, runs cross-row duplicate detection, writes CSV + JSON, prints summary.

- [ ] **Step 1: Create the script**

```ts
#!/usr/bin/env npx tsx
// scripts/audit-bc2-titles.ts

import { config } from "dotenv";
import { resolve, dirname } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import {
  classifyTitle,
  type Classification,
  type Flag,
  type PrimaryClass
} from "../lib/imports/bc2-title-classifier";

interface CliFlags {
  in: string;
  outCsv: string;
  outJson: string;
  clientsFromDb: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    return entry ? entry.split("=").slice(1).join("=") : null;
  };
  const has = (flag: string) => args.includes(`--${flag}`);
  return {
    in: get("in") ?? "tmp/bc2-titles.json",
    outCsv: get("out-csv") ?? "tmp/bc2-title-audit.csv",
    outJson: get("out-json") ?? "tmp/bc2-title-audit.json",
    clientsFromDb: has("clients-from-db")
  };
}

interface DumpRecord {
  id: number;
  name: string;
  archived: boolean;
  created_at: string;
}

interface DumpFile {
  generated_at: string;
  source: string;
  count: number;
  records: DumpRecord[];
}

interface AuditRow extends DumpRecord {
  primaryClass: PrimaryClass;
  flags: Flag[];
  code: string | null;
  num: string | null;
  parsedTitle: string;
}

interface DuplicateGroup {
  code: string;
  num: string;
  bc2_ids: number[];
  raw_titles: string[];
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function loadKnownClientCodes(): Promise<Set<string> | null> {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query<{ code: string }>("select code from clients");
    await pool.end();
    return new Set(res.rows.map((r) => r.code.toUpperCase()));
  } catch (err) {
    process.stderr.write(`  warn: --clients-from-db requested but DB query failed: ${(err as Error).message}\n`);
    return null;
  }
}

async function main() {
  const flags = parseFlags();
  const inPath = resolve(process.cwd(), flags.in);
  if (!existsSync(inPath)) {
    console.error(`Input dump not found: ${inPath}`);
    console.error("Run scripts/dump-bc2-titles.ts first to produce the dump.");
    process.exit(1);
  }

  const dump: DumpFile = JSON.parse(await readFile(inPath, "utf-8"));
  process.stdout.write(`Loaded ${dump.count} records from ${inPath}\n`);

  const knownCodes = flags.clientsFromDb ? await loadKnownClientCodes() : null;

  const rows: AuditRow[] = dump.records.map((rec) => {
    const c: Classification = classifyTitle(rec.name);
    const flagsList: Flag[] = [...c.flags];
    if (knownCodes && c.code && !knownCodes.has(c.code.toUpperCase())) {
      flagsList.push("unknown-client-code");
    }
    return { ...rec, primaryClass: c.primaryClass, flags: flagsList, code: c.code, num: c.num, parsedTitle: c.parsedTitle };
  });

  // Duplicate detection: bucket by `${code}|${num}`, only emit groups of size > 1.
  const buckets = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.code || !r.num) continue;
    const key = `${r.code}|${r.num}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const [code, num] = key.split("|");
    duplicates.push({
      code,
      num,
      bc2_ids: list.map((r) => r.id),
      raw_titles: list.map((r) => r.name)
    });
    for (const r of list) {
      if (!r.flags.includes("duplicate-code-num")) r.flags.push("duplicate-code-num");
    }
  }

  // CSV
  const csvHeader = ["bc2_id", "raw_title", "primary_class", "flags", "code", "num", "parsed_title", "archived", "created_at"];
  const csvLines = [csvHeader.join(",")];
  for (const r of rows) {
    csvLines.push([
      String(r.id),
      csvEscape(r.name),
      r.primaryClass,
      csvEscape(r.flags.join(";")),
      r.code ?? "",
      r.num ?? "",
      csvEscape(r.parsedTitle),
      String(r.archived),
      r.created_at
    ].join(","));
  }

  // JSON: counts + by_class + duplicates
  const counts: Record<string, number> = {};
  const byClass: Record<string, AuditRow[]> = {};
  for (const r of rows) {
    counts[r.primaryClass] = (counts[r.primaryClass] ?? 0) + 1;
    (byClass[r.primaryClass] = byClass[r.primaryClass] ?? []).push(r);
  }

  const jsonOut = {
    generated_at: new Date().toISOString(),
    source_dump: { generated_at: dump.generated_at, source: dump.source, count: dump.count },
    total: rows.length,
    counts,
    by_class: byClass,
    duplicates
  };

  const csvPath = resolve(process.cwd(), flags.outCsv);
  const jsonPath = resolve(process.cwd(), flags.outJson);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(csvPath + ".tmp", csvLines.join("\n") + "\n", "utf-8");
  await rename(csvPath + ".tmp", csvPath);
  await writeFile(jsonPath + ".tmp", JSON.stringify(jsonOut, null, 2), "utf-8");
  await rename(jsonPath + ".tmp", jsonPath);

  // Stdout summary
  process.stdout.write("\n--- Summary ---\n");
  process.stdout.write(`Total: ${rows.length}\n\n`);
  const classOrder = Object.keys(counts).sort((a, b) => {
    if (a === "clean") return -1;
    if (b === "clean") return 1;
    return counts[b] - counts[a];
  });
  for (const cls of classOrder) {
    process.stdout.write(`  ${cls.padEnd(20)} ${counts[cls]}\n`);
  }
  process.stdout.write("\n--- Top 10 per non-clean class ---\n");
  for (const cls of classOrder) {
    if (cls === "clean") continue;
    const top = (byClass[cls] ?? []).slice(0, 10);
    if (top.length === 0) continue;
    process.stdout.write(`\n[${cls}]\n`);
    for (const r of top) process.stdout.write(`  ${r.id}  ${JSON.stringify(r.name)}\n`);
  }
  if (duplicates.length > 0) {
    process.stdout.write(`\n--- Duplicates: ${duplicates.length} groups ---\n`);
    for (const d of duplicates.slice(0, 10)) {
      process.stdout.write(`  ${d.code}-${d.num}: ids=${d.bc2_ids.join(",")}\n`);
    }
  }
  process.stdout.write(`\nWrote:\n  ${csvPath}\n  ${jsonPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run unit tests one more time**

Run: `pnpm test tests/unit/bc2-title-classifier.test.ts`
Expected: PASS (regression check; classifier untouched in this task).

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-bc2-titles.ts
git commit -m "feat(bc2): add audit-bc2-titles script (classify, dedupe, CSV/JSON)"
```

---

## Task 9: End-to-end smoke with synthetic dump

**Files:**
- (Temporary file, no commit)

Verify the audit script works end-to-end without hitting BC2 by feeding it a hand-built dump.

- [ ] **Step 1: Write a synthetic dump file**

Use the Write tool to create `tmp/bc2-titles.synthetic.json`:

```json
{
  "generated_at": "2026-05-04T00:00:00Z",
  "source": "all",
  "count": 6,
  "records": [
    { "id": 1, "name": "GX-0042: Brand refresh", "archived": false, "created_at": "2024-01-01T00:00:00Z" },
    { "id": 2, "name": "GX-0042b: Variant brand refresh", "archived": false, "created_at": "2024-02-01T00:00:00Z" },
    { "id": 3, "name": "POMS - Website Software Update", "archived": false, "created_at": "2024-03-01T00:00:00Z" },
    { "id": 4, "name": "[ARCHIVED] GX-0050: Foo", "archived": true, "created_at": "2024-04-01T00:00:00Z" },
    { "id": 5, "name": "Some random project name", "archived": false, "created_at": "2024-05-01T00:00:00Z" },
    { "id": 6, "name": "GX-0042: Brand refresh duplicate", "archived": false, "created_at": "2024-06-01T00:00:00Z" }
  ]
}
```

- [ ] **Step 2: Run the audit against the synthetic dump**

Run:
```
pnpm exec tsx scripts/audit-bc2-titles.ts --in=tmp/bc2-titles.synthetic.json --out-csv=tmp/bc2-title-audit.synthetic.csv --out-json=tmp/bc2-title-audit.synthetic.json
```

Expected:
- Stdout summary lists `clean: 2`, `suffixed-num: 1`, `fallback-no-num: 1`, `prefix-noise: 1`, `no-code: 1`
- Duplicates section reports one group: `GX-0042` with ids `[1, 6]`
- Files `tmp/bc2-title-audit.synthetic.csv` and `tmp/bc2-title-audit.synthetic.json` are written

- [ ] **Step 3: Inspect outputs**

Read both output files and verify the duplicate row's `flags` includes `duplicate-code-num`, the `suffixed-num` row has `code=GX, num=0042b`, the `prefix-noise` row has `code=GX, num=0050`.

- [ ] **Step 4: Clean up synthetic files (no commit)**

```
rm tmp/bc2-titles.synthetic.json tmp/bc2-title-audit.synthetic.csv tmp/bc2-title-audit.synthetic.json
```

This task creates no commits — purely a smoke test using temporary files.

---

## Task 10: Run live audit and capture output

**Files:**
- (Output files only, gitignored)

Run the real pipeline to produce the artifacts the user actually wants.

- [ ] **Step 1: Verify env**

Confirm `.env.local` contains `BC2_ACCOUNT_ID` and `BC2_ACCESS_TOKEN`. If not, ask the user to provide them. Do NOT proceed without — the script will exit 1 cleanly via `requireEnv`.

- [ ] **Step 2: Dump titles (all sources)**

Run: `pnpm exec tsx scripts/dump-bc2-titles.ts --source=all`
Expected: writes `tmp/bc2-titles.json`. Note the record count.

- [ ] **Step 3: Run audit**

Run: `pnpm exec tsx scripts/audit-bc2-titles.ts`
Expected: writes `tmp/bc2-title-audit.csv` and `tmp/bc2-title-audit.json`. Stdout summary shows class breakdown.

- [ ] **Step 4: Hand off to user**

Print the stdout summary for the user. Ask which anomaly classes they want triaged first. This is the diagnostic output that motivates follow-up plans (parser fix, migrator fix, manual remediation list) — not implemented in this plan per spec scope.

No commit. Output files are gitignored.

---

## Self-Review Checklist (executed inline)

**Spec coverage:**
- Architecture diagram → Task 3, 7, 8 ✓
- Primary classes (11) → Task 5 + fixtures in Task 4 ✓
- Flags (7) → Task 6 + fixtures in Task 4; `unknown-client-code` in Task 8; `duplicate-code-num` in Task 8 ✓
- Best-effort code/num/parsed_title for non-clean rows → Task 5 returns these for every class ✓
- Atomic dump write → Task 7 step 1 (`.tmp` + rename) ✓
- CSV format with `;`-separated flags → Task 8 step 1 ✓
- JSON format with `counts`, `by_class`, `duplicates` → Task 8 step 1 ✓
- Stdout summary (counts + top 10 per class + dup groups) → Task 8 step 1 ✓
- `--source` flag (default `all`) → Task 7 step 1 ✓
- `--clients-from-db` flag (default off, never fails audit) → Task 8 step 1 ✓
- Drift-guard test → Task 4 step 1 ✓
- Out-of-scope items (no migrator changes, no remediation, no DB writes) → No tasks touch them ✓

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step has full code.

**Type consistency:** `Classification`, `PrimaryClass`, `Flag` defined in Task 3, used identically in Tasks 4, 5, 6, 8. `DumpRecord`/`DumpFile` consistent between Tasks 7 and 8.

No issues found.
