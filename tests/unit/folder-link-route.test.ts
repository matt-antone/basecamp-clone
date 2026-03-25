import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const createFolderLinkMock = vi.fn();
const getProjectStorageDirMock = vi.fn();
const isTeamSelectUserRequiredErrorMock = vi.fn(() => false);

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock
}));

vi.mock("@/lib/project-storage", () => ({
  getProjectStorageDir: getProjectStorageDirMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: vi.fn(() => ({
    createFolderLink: createFolderLinkMock
  })),
  isTeamSelectUserRequiredError: isTeamSelectUserRequiredErrorMock
}));

describe("/projects/[id]/folder-link route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    createFolderLinkMock.mockReset();
    getProjectStorageDirMock.mockReset();
    isTeamSelectUserRequiredErrorMock.mockReset();
    isTeamSelectUserRequiredErrorMock.mockReturnValue(false);
  });

  it("returns a JSON folder URL for an existing project", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getProjectStorageDirMock.mockReturnValue("/projects/bright-ridge/BRGS-0001-website-refresh");
    createFolderLinkMock.mockResolvedValue("https://dropbox.test/folder/project-1");

    const { GET } = await import("@/app/projects/[id]/folder-link/route");
    const response = await GET(new Request("http://localhost/projects/project-1/folder-link", { headers: { authorization: "Bearer token" } }), {
      params: Promise.resolve({ id: "project-1" })
    });

    expect(response.status).toBe(200);
    expect(getProjectMock).toHaveBeenCalledWith("project-1");
    expect(getProjectStorageDirMock).toHaveBeenCalledWith({ id: "project-1" });
    await expect(response.json()).resolves.toEqual({
      url: "https://dropbox.test/folder/project-1"
    });
  });

  it("returns not found when the project does not exist", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue(null);

    const { GET } = await import("@/app/projects/[id]/folder-link/route");
    const response = await GET(new Request("http://localhost/projects/project-1/folder-link", { headers: { authorization: "Bearer token" } }), {
      params: Promise.resolve({ id: "project-1" })
    });

    expect(response.status).toBe(404);
    expect(createFolderLinkMock).not.toHaveBeenCalled();
  });
});
