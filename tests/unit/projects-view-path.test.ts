import { describe, expect, it } from "vitest";
import { projectsNavHighlight, projectsViewTabFromPathname } from "@/lib/projects-view-path";

describe("projectsViewTabFromPathname", () => {
  it("maps home and flow/archive paths", () => {
    expect(projectsViewTabFromPathname("/")).toBe("list");
    expect(projectsViewTabFromPathname(null)).toBe("list");
    expect(projectsViewTabFromPathname("/flow")).toBe("board");
    expect(projectsViewTabFromPathname("/billing")).toBe("billing");
    expect(projectsViewTabFromPathname("/archive")).toBe("archived");
  });

  it("falls back to list for unknown paths", () => {
    expect(projectsViewTabFromPathname("/settings")).toBe("list");
    expect(projectsViewTabFromPathname("/some-uuid")).toBe("list");
  });
});

describe("projectsNavHighlight", () => {
  it("highlights only workspace routes", () => {
    expect(projectsNavHighlight("/")).toBe("list");
    expect(projectsNavHighlight("/flow")).toBe("board");
    expect(projectsNavHighlight("/billing")).toBe("billing");
    expect(projectsNavHighlight("/archive")).toBe("archived");
  });

  it("returns null off workspace routes", () => {
    expect(projectsNavHighlight("/settings")).toBeNull();
    expect(projectsNavHighlight("/abc-123")).toBeNull();
  });
});
