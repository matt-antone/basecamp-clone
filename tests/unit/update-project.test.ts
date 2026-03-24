import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("project metadata repository fields", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("reads requestor and personal_hours from project queries", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "project-1",
          name: "Website Refresh",
          requestor: "Client Services",
          personal_hours: "12.5"
        }
      ]
    });

    const { getProject } = await import("@/lib/repositories");
    const project = await getProject("project-1");

    expect(project).toMatchObject({
      id: "project-1",
      requestor: "Client Services",
      personal_hours: "12.5"
    });
  });

  it("updates requestor and personal_hours alongside the rest of the project payload", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            client_id: "client-1",
            tags: ["ops"],
            requestor: null,
            personal_hours: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "project-1",
            requestor: "Jane Producer",
            personal_hours: "18"
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
      requestor: "Jane Producer",
      personalHours: 18
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toContain("requestor = $5");
    expect(sql).toContain("personal_hours = $6");
    expect(params).toEqual([
      "project-1",
      "Website Refresh",
      "Updated brief",
      ["ops"],
      "Jane Producer",
      18
    ]);
  });
});
