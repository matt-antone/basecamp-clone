import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const uploadInitMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    uploadInit = uploadInitMock;
  },
  isTeamSelectUserRequiredError: () => false
}));

describe("POST /projects/[id]/files/upload-init", () => {
  beforeEach(() => {
    vi.resetModules();
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    assertClientNotArchivedForMutationMock.mockReset();
    uploadInitMock.mockReset();
  });

  it("returns 409 when the client is archived", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      client_id: "11111111-1111-1111-1111-111111111111",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    assertClientNotArchivedForMutationMock.mockRejectedValue(
      new Error("Client is archived. Restore it before uploading files.")
    );

    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-init", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          filename: "brief.pdf",
          sizeBytes: 1234,
          mimeType: "application/pdf"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Client is archived. Restore it before uploading files."
    });
    expect(assertClientNotArchivedForMutationMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({
        archived: "Client is archived. Restore it before uploading files."
      })
    );
    expect(uploadInitMock).not.toHaveBeenCalled();
  });
});
