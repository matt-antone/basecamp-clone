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
  { id: "id-abi", code: "ABI", name: "ABI" },
  { id: "id-shalom", code: "ShalomInstitute", name: "Shalom Institute" }
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
  { raw: "   ", matchedBy: "none", clientId: null, code: null, num: null, title: "", confidence: "low" },

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

  it("colon-with-num auto-create when lead is unknown (Step 2.5 Case A)", () => {
    const r = resolveTitle("EcoTech: 001-Energy Int'l Logo", KNOWN);
    expect(r.matchedBy).toBe("auto-create-pending");
    expect(r.code).toBe("EcoTech");
    expect(r.num).toBe("001");
    expect(r.title).toBe("Energy Int'l Logo");
    expect(r.confidence).toBe("medium");
    expect(r.autoCreatePrefix).toBe("EcoTech");
  });
});
