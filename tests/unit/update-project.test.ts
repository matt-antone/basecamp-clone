import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("project metadata repository fields", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("reads requestor and my_hours from project queries", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "project-1",
          name: "Website Refresh",
          requestor: "Client Services",
          my_hours: "12.5"
        }
      ]
    });

    const { getProject } = await import("@/lib/repositories");
    const project = await getProject("project-1", "user-1");

    expect(project).toMatchObject({
      id: "project-1",
      requestor: "Client Services",
      my_hours: "12.5"
    });
  });

  it("falls back when the per-user hours table has not been migrated yet", async () => {
    queryMock
      .mockRejectedValueOnce(new Error('relation "project_user_hours" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            name: "Website Refresh",
            requestor: "Client Services",
            my_hours: null
          }
        ]
      });

    const { getProject } = await import("@/lib/repositories");
    const project = await getProject("project-1", "user-1");

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(project).toMatchObject({
      id: "project-1",
      requestor: "Client Services",
      my_hours: null
    });
  });

  it("updates requestor alongside the rest of the project payload", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            client_id: "client-1",
            tags: ["ops"],
            requestor: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            requestor: "Jane Producer"
          }
        ]
      });

    const { updateProject } = await import("@/lib/repositories");
    await updateProject({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "client-1",
      tags: ["ops"],
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("requestor = $5");
    expect(params).toEqual([
      "project-1",
      "Website Refresh",
      "Updated brief",
      ["ops"],
      "Jane Producer"
    ]);
  });

  it("falls back when the requestor column has not been migrated yet", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            client_id: "client-1",
            tags: ["ops"]
          }
        ]
      })
      .mockRejectedValueOnce(new Error('column "requestor" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            name: "Website Refresh"
          }
        ]
      });

    const { updateProject } = await import("@/lib/repositories");
    await updateProject({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "client-1",
      tags: ["ops"],
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    const [fallbackSql, fallbackParams] = queryMock.mock.calls[2];
    expect(fallbackSql).not.toContain("requestor =");
    expect(fallbackSql).toContain("tags = $4::text[]");
    expect(fallbackParams).toEqual(["project-1", "Website Refresh", "Updated brief", ["ops"]]);
  });

  it("upserts project hours for a specific user", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ project_id: "project-1", user_id: "user-1", hours: "6.5" }]
    });

    const { setProjectUserHours } = await import("@/lib/repositories");
    await setProjectUserHours({
      projectId: "project-1",
      userId: "user-1",
      hours: 6.5
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("insert into project_user_hours");
    expect(sql).toContain("on conflict (project_id, user_id)");
    expect(params).toEqual(["project-1", "user-1", 6.5]);
  });
});
