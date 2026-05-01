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
            client_slug: "Bright-Ridge",
            project_slug: "website-refresh",
            storage_project_dir: "/projects/BRGS/BRGS-0007-Website Refresh"
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { createProject } = await import("@/lib/repositories");

    await createProject({
      name: "Website Refresh",
      description: "Revamp the marketing site",
      createdBy: "user-1",
      clientId: "client-1",
      tags: ["Marketing", "Launch"],
      deadline: "2026-04-30",
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("requestor");
    expect(sql).toContain("storage_project_dir");
    expect(sql).toContain("deadline");
    expect(sql).toContain("where client_id = $4::uuid");
    expect(sql).toContain("$4::uuid::text");
    expect(sql).toContain("upper(trim($5))");
    expect(sql).toContain("regexp_replace");
    expect(params[5]).toBe("Bright-Ridge");
    expect(params[8]).toBe("/projects");
    expect(params[9]).toBe("2026-04-30");
    expect(params[10]).toBe("Jane Producer");
  });

  it("inserts the creator into project_members after creating the project", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "client-1", name: "Acme", code: "ACME" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-77",
            project_code: "ACME-0001",
            client_slug: "Acme",
            project_slug: "kickoff",
            storage_project_dir: "/projects/ACME/ACME-0001-Kickoff"
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { createProject } = await import("@/lib/repositories");

    await createProject({
      name: "Kickoff",
      description: "First project",
      createdBy: "user-77",
      clientId: "client-1",
      tags: [],
      deadline: null,
      requestor: null
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    const [memberSql, memberParams] = queryMock.mock.calls[2];
    expect(memberSql).toMatch(/insert into project_members/i);
    expect(memberParams).toEqual(["project-77", "user-77"]);
  });

  it("inserts the creator into project_members on the fallback path", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "client-2", name: "Old Corp", code: "OLDC" }]
      })
      .mockRejectedValueOnce(new Error('column "deadline" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-99",
            project_code: "OLDC-0001",
            client_slug: "Old-Corp",
            project_slug: "legacy",
            storage_project_dir: "/projects/OLDC/OLDC-0001-Legacy"
          }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { createProject } = await import("@/lib/repositories");

    await createProject({
      name: "Legacy",
      description: "Old project",
      createdBy: "user-99",
      clientId: "client-2",
      tags: [],
      deadline: null,
      requestor: null
    });

    expect(queryMock).toHaveBeenCalledTimes(4);
    const [memberSql, memberParams] = queryMock.mock.calls[3];
    expect(memberSql).toMatch(/insert into project_members/i);
    expect(memberParams).toEqual(["project-99", "user-99"]);
  });
});
