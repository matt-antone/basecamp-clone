import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const listProjectExpenseLinesMock = vi.fn();
const createProjectExpenseLineMock = vi.fn();
const updateProjectExpenseLineMock = vi.fn();
const deleteProjectExpenseLineMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  listProjectExpenseLines: listProjectExpenseLinesMock,
  createProjectExpenseLine: createProjectExpenseLineMock,
  updateProjectExpenseLine: updateProjectExpenseLineMock,
  deleteProjectExpenseLine: deleteProjectExpenseLineMock
}));

describe("/projects/[id]/expense-lines routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    listProjectExpenseLinesMock.mockReset();
    createProjectExpenseLineMock.mockReset();
    updateProjectExpenseLineMock.mockReset();
    deleteProjectExpenseLineMock.mockReset();
  });

  it("lists expense lines for a project", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    listProjectExpenseLinesMock.mockResolvedValue([
      { id: "line-1", projectId: "project-1", label: "Travel", amount: "245.50", sortOrder: 0 }
    ]);

    const { GET } = await import("@/app/projects/[id]/expense-lines/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/expense-lines", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(listProjectExpenseLinesMock).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toEqual({
      expenseLines: [{ id: "line-1", projectId: "project-1", label: "Travel", amount: "245.50", sortOrder: 0 }]
    });
  });

  it("creates a new expense line", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    createProjectExpenseLineMock.mockResolvedValue({
      id: "line-1",
      projectId: "project-1",
      label: "Travel",
      amount: "245.50",
      sortOrder: 2
    });

    const { POST } = await import("@/app/projects/[id]/expense-lines/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/expense-lines", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          label: "  Travel  ",
          amount: 245.5
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(createProjectExpenseLineMock).toHaveBeenCalledWith({
      projectId: "project-1",
      label: "Travel",
      amount: 245.5,
      sortOrder: undefined
    });
    await expect(response.json()).resolves.toEqual({
      expenseLine: {
        id: "line-1",
        projectId: "project-1",
        label: "Travel",
        amount: "245.50",
        sortOrder: 2
      }
    });
  });

  it("updates an existing expense line", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    updateProjectExpenseLineMock.mockResolvedValue({
      id: "line-1",
      projectId: "project-1",
      label: "Lodging",
      amount: "320.00",
      sortOrder: 3
    });

    const { PATCH } = await import("@/app/projects/[id]/expense-lines/[lineId]/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/expense-lines/line-1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          label: "  Lodging  ",
          amount: 320,
          sortOrder: 3
        })
      }),
      { params: Promise.resolve({ id: "project-1", lineId: "line-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateProjectExpenseLineMock).toHaveBeenCalledWith({
      id: "line-1",
      projectId: "project-1",
      label: "Lodging",
      amount: 320,
      sortOrder: 3
    });
    await expect(response.json()).resolves.toEqual({
      expenseLine: {
        id: "line-1",
        projectId: "project-1",
        label: "Lodging",
        amount: "320.00",
        sortOrder: 3
      }
    });
  });

  it("deletes an expense line", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    deleteProjectExpenseLineMock.mockResolvedValue(true);

    const { DELETE } = await import("@/app/projects/[id]/expense-lines/[lineId]/route");
    const response = await DELETE(
      new Request("http://localhost/projects/project-1/expense-lines/line-1", {
        method: "DELETE",
        headers: {
          authorization: "Bearer token"
        }
      }),
      { params: Promise.resolve({ id: "project-1", lineId: "line-1" }) }
    );

    expect(response.status).toBe(200);
    expect(deleteProjectExpenseLineMock).toHaveBeenCalledWith({
      id: "line-1",
      projectId: "project-1"
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects invalid expense amounts", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });

    const { POST } = await import("@/app/projects/[id]/expense-lines/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/expense-lines", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          label: "Travel",
          amount: -1
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
    expect(createProjectExpenseLineMock).not.toHaveBeenCalled();
  });
});
