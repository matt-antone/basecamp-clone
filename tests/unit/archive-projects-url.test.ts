import { describe, expect, it } from "vitest";
import { buildArchiveProjectsUrl } from "@/lib/archive-projects-url";

describe("buildArchiveProjectsUrl", () => {
  it("omits clientId when null", () => {
    expect(buildArchiveProjectsUrl({ search: "", page: 1, clientId: null })).toBe(
      "/projects/archived?search=&page=1&limit=20"
    );
  });

  it("includes clientId when provided", () => {
    expect(
      buildArchiveProjectsUrl({ search: "", page: 1, clientId: "c-123" })
    ).toBe("/projects/archived?search=&page=1&limit=20&clientId=c-123");
  });

  it("includes search text verbatim (server handles trimming)", () => {
    expect(
      buildArchiveProjectsUrl({ search: "alpha", page: 2, clientId: null })
    ).toBe("/projects/archived?search=alpha&page=2&limit=20");
  });

  it("combines search and clientId", () => {
    expect(
      buildArchiveProjectsUrl({ search: "alpha", page: 3, clientId: "c-1" })
    ).toBe("/projects/archived?search=alpha&page=3&limit=20&clientId=c-1");
  });

  it("treats empty-string clientId as omitted", () => {
    expect(
      buildArchiveProjectsUrl({ search: "", page: 1, clientId: "" })
    ).toBe("/projects/archived?search=&page=1&limit=20");
  });
});
