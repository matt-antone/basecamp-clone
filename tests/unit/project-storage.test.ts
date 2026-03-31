import { describe, expect, it } from "vitest";
import {
  buildDropboxProjectFolderBaseName,
  clientCodeFromProjectCode,
  getProjectStorageDir,
  getProjectStorageDirForArchiveState,
  sanitizeDropboxFolderTitle
} from "@/lib/project-storage";

describe("project storage paths", () => {
  it("uses /Projects/<CLIENTCODE>/<PROJECT_CODE>-<display title> when project_code ends with -####", () => {
    const project = {
      name: "Website Refresh",
      client_slug: "bright-ridge",
      project_code: "BRGS-0001",
      project_slug: "website-refresh",
      archived: false
    };

    expect(buildDropboxProjectFolderBaseName(project)).toBe("BRGS-0001-Website Refresh");
    expect(getProjectStorageDirForArchiveState(project, false)).toBe(
      "/Projects/BRGS/BRGS-0001-Website Refresh"
    );
    expect(getProjectStorageDirForArchiveState(project, true)).toBe(
      "/Projects/BRGS/_Archive/BRGS-0001-Website Refresh"
    );
  });

  it("sanitizeDropboxFolderTitle strips unsafe path characters and normalizes spaces", () => {
    expect(sanitizeDropboxFolderTitle(" A: B / C ")).toBe("A B C");
    expect(sanitizeDropboxFolderTitle("")).toBe("project");
  });

  it("strips the numeric suffix from project_code for the client code segment", () => {
    expect(clientCodeFromProjectCode("BRGS-0001")).toBe("BRGS");
    expect(clientCodeFromProjectCode("BRGS-00012")).toBe("BRGS-00012");
  });

  it("preserves the stored folder name (including Dropbox de-dupe suffixes)", () => {
    const project = {
      client_slug: "bright-ridge",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Website Refresh-2",
      archived: true
    };

    expect(getProjectStorageDir(project)).toBe("/Projects/BRGS/BRGS-0001-Website Refresh-2");
    expect(getProjectStorageDirForArchiveState(project, true)).toBe(
      "/Projects/BRGS/_Archive/BRGS-0001-Website Refresh-2"
    );
    expect(getProjectStorageDirForArchiveState(project, false)).toBe(
      "/Projects/BRGS/BRGS-0001-Website Refresh-2"
    );
  });

  it("derives client code from client_code when joined from clients (legacy basename without -#### project_code)", () => {
    const project = {
      client_code: "brgs",
      client_slug: "bright-ridge",
      project_slug: "website-refresh",
      archived: false
    };

    expect(getProjectStorageDir(project)).toBe("/Projects/BRGS/BRGS-bright-ridge-website-refresh");
    expect(getProjectStorageDirForArchiveState(project, true)).toBe(
      "/Projects/BRGS/_Archive/BRGS-bright-ridge-website-refresh"
    );
  });

  it("preserves client code under multi-segment DROPBOX project roots", () => {
    const active = {
      storage_project_dir: "/Glyphix Dropbox/Team Projects/BRGS/BRGS-client-site",
      archived: false
    };
    expect(getProjectStorageDirForArchiveState(active, false)).toBe(
      "/Glyphix Dropbox/Team Projects/BRGS/BRGS-client-site"
    );
    expect(getProjectStorageDirForArchiveState(active, true)).toBe(
      "/Glyphix Dropbox/Team Projects/BRGS/_Archive/BRGS-client-site"
    );

    const inArchive = {
      storage_project_dir: "/Glyphix Dropbox/Team Projects/BRGS/_Archive/BRGS-client-site",
      archived: true
    };
    expect(getProjectStorageDirForArchiveState(inArchive, true)).toBe(
      "/Glyphix Dropbox/Team Projects/BRGS/_Archive/BRGS-client-site"
    );
  });
});
