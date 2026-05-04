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
  { raw: "GX-0042:   ", primaryClass: "empty-title", flags: ["leading-trailing-ws"], code: "GX", num: "0042", parsedTitle: "" },

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
  { raw: "GX – Foo", primaryClass: "fallback-no-num", flags: ["en-dash-separator", "non-ascii"], code: "GX", num: null, parsedTitle: "Foo" },

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
      // Classifier trims before matching; mirror that so drift guard isolates regex divergence,
      // not whitespace handling (which the classifier reports separately via leading-trailing-ws flag).
      const parsed = parseProjectTitle(String(f.raw).trim());
      expect(parsed.code?.toLowerCase()).toBe(f.code?.toLowerCase());
      expect(parsed.num).toBe(f.num);
      expect(parsed.title).toBe(f.parsedTitle);
    });
  }
});
