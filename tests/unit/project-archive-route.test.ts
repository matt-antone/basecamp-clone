import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getProjectStorageDirMock = vi.fn();
const getProjectStorageDirForArchiveStateMock = vi.fn();
const moveProjectFolderMock = vi.fn();
const setProjectArchivedWithStorageDirMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/project-storage", () => ({
  getProjectStorageDir: getProjectStorageDirMock,
  getProjectStorageDirForArchiveState: getProjectStorageDirForArchiveStateMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  setProjectArchivedWithStorageDir: setProjectArchivedWithStorageDirMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: vi.fn(() => ({
    moveProjectFolder: moveProjectFolderMock
  })),
  isTeamSelectUserRequiredError: vi.fn(() => false)
}));

describe("POST /projects/[id]/archive", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getProjectStorageDirMock.mockReset();
    getProjectStorageDirForArchiveStateMock.mockReset();
    moveProjectFolderMock.mockReset();
    setProjectArchivedWithStorageDirMock.mockReset();
  });

  it("moves the project folder into archive and stores archived state", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      archived: false,
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Acme Website Refresh"
    });
    getProjectStorageDirMock.mockReturnValue("/Projects/BRGS/BRGS-0001-Acme Website Refresh");
    getProjectStorageDirForArchiveStateMock.mockReturnValue("/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh");
    moveProjectFolderMock.mockResolvedValue({
      projectDir: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    });
    setProjectArchivedWithStorageDirMock.mockResolvedValue({
      id: "project-1",
      archived: true
    });

    const { POST } = await import("@/app/projects/[id]/archive/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/archive", {
        method: "POST",
        headers: {
          authorization: "Bearer token"
        }
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(moveProjectFolderMock).toHaveBeenCalledWith({
      fromPath: "/Projects/BRGS/BRGS-0001-Acme Website Refresh",
      toPath: "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    });
    expect(setProjectArchivedWithStorageDirMock).toHaveBeenCalledWith(
      "project-1",
      true,
      "/Projects/BRGS/_Archive/BRGS-0001-Acme Website Refresh"
    );
    await expect(response.json()).resolves.toMatchObject({
      project: { id: "project-1", archived: true }
    });
  });
});
