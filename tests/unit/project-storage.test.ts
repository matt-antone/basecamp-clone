import { describe, expect, it } from "vitest";
import { getProjectStorageDir, getProjectStorageDirForArchiveState } from "@/lib/project-storage";

describe("project storage paths", () => {
  it("places archived projects under the client _Archive folder", () => {
    const project = {
      client_slug: "brgs",
      project_code: "BRGS-0001",
      project_slug: "website-refresh",
      archived: false
    };

    expect(getProjectStorageDirForArchiveState(project, true)).toBe("/projects/brgs/_Archive/BRGS-0001-website-refresh");
    expect(getProjectStorageDirForArchiveState(project, false)).toBe("/projects/brgs/BRGS-0001-website-refresh");
  });

  it("preserves the existing folder name when moving archived projects", () => {
    const project = {
      client_slug: "brgs",
      storage_project_dir: "/projects/brgs/BRGS-0001-website-refresh-2",
      archived: true
    };

    expect(getProjectStorageDir(project)).toBe("/projects/brgs/BRGS-0001-website-refresh-2");
    expect(getProjectStorageDirForArchiveState(project, true)).toBe("/projects/brgs/_Archive/BRGS-0001-website-refresh-2");
    expect(getProjectStorageDirForArchiveState(project, false)).toBe("/projects/brgs/BRGS-0001-website-refresh-2");
  });

  it("preserves client name capitalization when deriving the Dropbox client directory", () => {
    const project = {
      client_name: "Bright Ridge",
      project_code: "BRGS-0001",
      project_slug: "website-refresh",
      archived: false
    };

    expect(getProjectStorageDir(project)).toBe("/projects/Bright-Ridge/BRGS-0001-website-refresh");
    expect(getProjectStorageDirForArchiveState(project, true)).toBe("/projects/Bright-Ridge/_Archive/BRGS-0001-website-refresh");
  });
});
