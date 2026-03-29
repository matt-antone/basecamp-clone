// tests/unit/bc2-transformer.test.ts
import { describe, it, expect } from "vitest";
import { parseProjectTitle } from "@/lib/imports/bc2-transformer";

describe("parseProjectTitle", () => {
  it("parses standard format with number", () => {
    const r = parseProjectTitle("Poms-1414: Purple Mushroom Package");
    expect(r).toEqual({ code: "Poms", num: "1414", title: "Purple Mushroom Package" });
  });

  it("parses four-digit codes", () => {
    const r = parseProjectTitle("JFLA-444: Invitation Graphic");
    expect(r).toEqual({ code: "JFLA", num: "444", title: "Invitation Graphic" });
  });

  it("parses format without number (hyphen dash)", () => {
    const r = parseProjectTitle("GX-Website Review");
    expect(r).toEqual({ code: "GX", num: null, title: "Website Review" });
  });

  it("parses format without number (spaced dash)", () => {
    const r = parseProjectTitle("POMS - Website Software Update");
    expect(r).toEqual({ code: "POMS", num: null, title: "Website Software Update" });
  });

  it("returns null code and num for unrecognized format", () => {
    const r = parseProjectTitle("Some random project name");
    expect(r).toEqual({ code: null, num: null, title: "Some random project name" });
  });

  it("strips whitespace from title", () => {
    const r = parseProjectTitle("ALG-100:  Spaced Title  ");
    expect(r).toEqual({ code: "ALG", num: "100", title: "Spaced Title" });
  });
});
