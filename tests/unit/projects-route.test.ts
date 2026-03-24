import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const createProjectMock = vi.fn();
const listProjectsMock = vi.fn();
const deleteProjectByIdMock = vi.fn();
const setProjectStorageDirMock = vi.fn();
const ensureProjectFoldersMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  createProject: createProjectMock,
  listProjects: listProjectsMock,
  deleteProjectById: deleteProjectByIdMock,
  setProjectStorageDir: setProjectStorageDirMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: vi.fn(() => ({
    ensureProjectFolders: ensureProjectFoldersMock
  })),
  getDropboxErrorSummary: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
  isTeamSelectUserRequiredError: vi.fn(() => false)
}));

describe("POST /projects", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    createProjectMock.mockReset();
    listProjectsMock.mockReset();
    deleteProjectByIdMock.mockReset();
    setProjectStorageDirMock.mockReset();
    ensureProjectFoldersMock.mockReset();
  });

  it("rolls back and returns a clear error when Dropbox provisioning fails", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    createProjectMock.mockResolvedValue({
      id: "project-1",
      project_code: "BRGS-0001",
      project_slug: "website-refresh",
      client_slug: "bright-ridge",
      storage_project_dir: "/projects/bright-ridge/BRGS-0001-website-refresh"
    });
    ensureProjectFoldersMock.mockRejectedValue(new Error("Dropbox offline"));
    deleteProjectByIdMock.mockResolvedValue(undefined);

    const { POST } = await import("@/app/projects/route");
    const response = await POST(
      new Request("http://localhost/projects", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Website Refresh",
          clientId: "11111111-1111-1111-1111-111111111111"
        })
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Project creation failed while provisioning Dropbox folders: Dropbox offline"
    });
    expect(deleteProjectByIdMock).toHaveBeenCalledWith("project-1");
    expect(setProjectStorageDirMock).not.toHaveBeenCalled();
  });

  it("passes requestor through when creating a project", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    createProjectMock.mockResolvedValue({
      id: "project-1",
      project_code: "BRGS-0001",
      project_slug: "website-refresh",
      client_slug: "bright-ridge",
      storage_project_dir: "/projects/bright-ridge/BRGS-0001-website-refresh"
    });
    ensureProjectFoldersMock.mockResolvedValue({
      projectDir: "/projects/bright-ridge/BRGS-0001-website-refresh"
    });
    setProjectStorageDirMock.mockResolvedValue({
      id: "project-1",
      requestor: "Jane Producer"
    });

    const { POST } = await import("@/app/projects/route");
    const response = await POST(
      new Request("http://localhost/projects", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Website Refresh",
          clientId: "11111111-1111-1111-1111-111111111111",
          requestor: "Jane Producer"
        })
      })
    );

    expect(response.status).toBe(201);
    expect(createProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestor: "Jane Producer"
      })
    );
  });
});
