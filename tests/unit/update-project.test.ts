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
          deadline: "2026-04-30",
          requestor: "Client Services",
          my_hours: "12.5"
        }
      ]
    });

    const { getProject } = await import("@/lib/repositories");
    const project = await getProject("project-1", "user-1");

    expect(project).toMatchObject({
      id: "project-1",
      deadline: "2026-04-30",
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
            deadline: null,
            requestor: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            deadline: "2026-05-15",
            requestor: "Jane Producer"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { updateProject } = await import("@/lib/repositories");
    await updateProject({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "client-1",
      tags: ["ops"],
      deadline: "2026-05-15",
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("deadline = $5::date");
    expect(sql).toContain("requestor = $6");
    expect(params).toEqual([
      "project-1",
      "Website Refresh",
      "Updated brief",
      ["ops"],
      "2026-05-15",
      "Jane Producer"
    ]);
    // 3rd call should be the activity touch
    const [touchSql, touchParams] = queryMock.mock.calls[2];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("last_activity_at = greatest(");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["project-1"]);
  });

  it("falls back when the requestor column has not been migrated yet", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            client_id: "client-1",
            tags: ["ops"],
            deadline: null
          }
        ]
      })
      .mockRejectedValueOnce(new Error('column "requestor" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            name: "Website Refresh",
            deadline: "2026-05-15"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { updateProject } = await import("@/lib/repositories");
    await updateProject({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "client-1",
      tags: ["ops"],
      deadline: "2026-05-15",
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(4);
    const [fallbackSql, fallbackParams] = queryMock.mock.calls[2];
    expect(fallbackSql).not.toContain("requestor =");
    expect(fallbackSql).toContain("deadline = $5::date");
    expect(fallbackParams).toEqual(["project-1", "Website Refresh", "Updated brief", ["ops"], "2026-05-15"]);
    const [touchSql, touchParams] = queryMock.mock.calls[3];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("last_activity_at = greatest(");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["project-1"]);
  });

  it("falls back when the deadline column has not been migrated yet", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            client_id: "client-1",
            tags: ["ops"],
            requestor: "Jane Producer"
          }
        ]
      })
      .mockRejectedValueOnce(new Error('column "deadline" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            name: "Website Refresh",
            requestor: "Jane Producer"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { updateProject } = await import("@/lib/repositories");
    await updateProject({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "client-1",
      tags: ["ops"],
      deadline: "2026-05-15",
      requestor: "Jane Producer"
    });

    expect(queryMock).toHaveBeenCalledTimes(4);
    const [fallbackSql, fallbackParams] = queryMock.mock.calls[2];
    expect(fallbackSql).not.toContain("deadline =");
    expect(fallbackSql).toContain("tags = $4::text[]");
    expect(fallbackParams).toEqual(["project-1", "Website Refresh", "Updated brief", ["ops"]]);
    const [touchSql, touchParams] = queryMock.mock.calls[3];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("last_activity_at = greatest(");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["project-1"]);
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

  it("lists project user hours with joined profile details", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          userId: "user-1",
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          avatarUrl: "https://example.com/avatar.jpg",
          hours: "7.25"
        }
      ]
    });

    const { listProjectUserHours } = await import("@/lib/repositories");
    const userHours = await listProjectUserHours("project-1");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(userHours).toEqual([
      {
        userId: "user-1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        avatarUrl: "https://example.com/avatar.jpg",
        hours: "7.25"
      }
    ]);
  });

  it("reads and updates site settings", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ siteTitle: "Studio Portal", logoUrl: "/logo.png" }]
      })
      .mockResolvedValueOnce({
        rows: [{ siteTitle: "Studio Portal", logoUrl: "https://cdn.example.com/logo.png" }]
      });

    const { getSiteSettings, upsertSiteSettings } = await import("@/lib/repositories");
    await expect(getSiteSettings()).resolves.toEqual({
      siteTitle: "Studio Portal",
      logoUrl: "/logo.png"
    });
    await expect(
      upsertSiteSettings({
        siteTitle: "Studio Portal",
        logoUrl: "https://cdn.example.com/logo.png"
      })
    ).resolves.toEqual({
      siteTitle: "Studio Portal",
      logoUrl: "https://cdn.example.com/logo.png"
    });
  });
});
