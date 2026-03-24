import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("createProject", () => {
  beforeEach(() => {
    process.env.DROPBOX_PROJECTS_ROOT_FOLDER = "/projects";
    queryMock.mockReset();
  });

  it("persists an initial storage_project_dir for newly created projects", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "client-1", name: "Bright Ridge", code: "BRGS" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            project_code: "BRGS-0007",
            client_slug: "bright-ridge",
            project_slug: "website-refresh",
            storage_project_dir: "/projects/bright-ridge/BRGS-0007-website-refresh"
          }
        ]
      });

    const { createProject } = await import("@/lib/repositories");

    await createProject({
      name: "Website Refresh",
      description: "Revamp the marketing site",
      createdBy: "user-1",
      clientId: "client-1",
      tags: ["Marketing", "Launch"]
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("storage_project_dir");
    expect(sql).toContain("where client_id = $4::uuid");
    expect(sql).toContain("$4::uuid::text");
    expect(params[5]).toBe("Bright-Ridge");
    expect(params[8]).toBe("/projects");
  });
});
