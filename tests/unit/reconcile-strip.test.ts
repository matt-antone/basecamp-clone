import { describe, expect, it } from "vitest";
import { resolveCollision, stripPrefix } from "@/lib/reconcile-filenames/strip";

describe("stripPrefix", () => {
  it("strips 13-digit timestamp + numeric id prefix", () => {
    expect(stripPrefix("1775067993312-521625632-EPGGB-2026-newsletter01-r2.pdf")).toBe(
      "EPGGB-2026-newsletter01-r2.pdf"
    );
  });

  it("returns null when only a 13-digit timestamp prefix is present", () => {
    expect(stripPrefix("1775067993312-foo.pdf")).toBeNull();
  });

  it("returns null for unprefixed names", () => {
    expect(stripPrefix("EPGGB-2026-newsletter01-r2.pdf")).toBeNull();
  });

  it("returns null when timestamp is not exactly 13 digits", () => {
    expect(stripPrefix("123-456-foo.pdf")).toBeNull();
    expect(stripPrefix("17750679933121-521625632-foo.pdf")).toBeNull();
  });

  it("returns null when second group is not numeric", () => {
    expect(stripPrefix("1775067993312-abc-foo.pdf")).toBeNull();
  });

  it("returns null when there is no remainder after the prefix", () => {
    expect(stripPrefix("1775067993312-521625632-")).toBeNull();
  });
});

describe("resolveCollision", () => {
  it("returns target unchanged when not taken", () => {
    const taken = new Set<string>();
    expect(resolveCollision("foo.pdf", taken)).toBe("foo.pdf");
    expect(taken.has("foo.pdf")).toBe(true);
  });

  it("appends -2 when target is taken", () => {
    const taken = new Set(["foo.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo-2.pdf");
    expect(taken.has("foo-2.pdf")).toBe(true);
  });

  it("increments suffix until free", () => {
    const taken = new Set(["foo.pdf", "foo-2.pdf", "foo-3.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo-4.pdf");
  });

  it("inserts suffix before the last dot for multi-dot extensions", () => {
    const taken = new Set(["foo.tar.gz"]);
    expect(resolveCollision("foo.tar.gz", taken)).toBe("foo.tar-2.gz");
  });

  it("appends bare -N to extensionless names", () => {
    const taken = new Set(["README"]);
    expect(resolveCollision("README", taken)).toBe("README-2");
  });

  it("is case-sensitive (matches Dropbox behaviour)", () => {
    const taken = new Set(["Foo.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo.pdf");
  });
});
