import { describe, expect, it } from "vitest";
import { getAvatarProxyUrl, isAllowedAvatarUrl } from "@/lib/avatar";

describe("avatar helpers", () => {
  it("builds a local proxy URL for allowed avatar sources", () => {
    expect(getAvatarProxyUrl("https://lh3.googleusercontent.com/a/example=s96-c")).toBe(
      "/avatar?src=https%3A%2F%2Flh3.googleusercontent.com%2Fa%2Fexample%3Ds96-c"
    );
  });

  it("allows googleusercontent avatar hosts", () => {
    expect(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/example=s96-c")).toBe(true);
    expect(isAllowedAvatarUrl("https://googleusercontent.com/u5.png")).toBe(true);
  });

  it("rejects non-avatar hosts", () => {
    expect(isAllowedAvatarUrl("https://example.com/avatar.png")).toBe(false);
    expect(isAllowedAvatarUrl("file:///tmp/avatar.png")).toBe(false);
  });
});
