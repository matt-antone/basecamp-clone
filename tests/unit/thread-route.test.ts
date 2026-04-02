import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const createThreadMock = vi.fn();
const listThreadsMock = vi.fn();
const getUserProfileByIdMock = vi.fn();
const listNotificationRecipientsMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const sendThreadCreatedEmailMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
  getProject: getProjectMock,
  createThread: createThreadMock,
  listThreads: listThreadsMock,
  getUserProfileById: getUserProfileByIdMock,
  listNotificationRecipients: listNotificationRecipientsMock
}));

vi.mock("@/lib/mailer", () => ({
  sendThreadCreatedEmail: sendThreadCreatedEmailMock
}));

describe("POST /projects/[id]/threads", () => {
  beforeEach(() => {
    vi.resetModules();
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    createThreadMock.mockReset();
    listThreadsMock.mockReset();
    getUserProfileByIdMock.mockReset();
    listNotificationRecipientsMock.mockReset();
    assertClientNotArchivedForMutationMock.mockReset();
    sendThreadCreatedEmailMock.mockReset();
  });

  it("returns 201 and sends email when thread creation succeeds", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", name: "Blue Sky" });
    createThreadMock.mockResolvedValue({ id: "thread-1", title: "Kickoff notes" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([
      { id: "user-2", email: "jamie@example.com", firstName: "Jamie", lastName: "Teammate" }
    ]);
    sendThreadCreatedEmailMock.mockResolvedValue({ skipped: false, recipientCount: 1 });

    const { POST } = await import("@/app/projects/[id]/threads/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Kickoff notes",
          bodyMarkdown: "Opening post"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(listNotificationRecipientsMock).toHaveBeenCalledWith("user-1");
    expect(sendThreadCreatedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project: { id: "project-1", name: "Blue Sky" },
        thread: { id: "thread-1", title: "Kickoff notes" },
        actor: { name: "Alex Author", email: "author@example.com" },
        recipients: [{ email: "jamie@example.com", name: "Jamie Teammate" }]
      })
    );
  });

  it("returns 201 and logs failure when email sending throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", name: "Blue Sky" });
    createThreadMock.mockResolvedValue({ id: "thread-1", title: "Kickoff notes" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([
      { id: "user-2", email: "jamie@example.com", firstName: "Jamie", lastName: "Teammate" }
    ]);
    sendThreadCreatedEmailMock.mockRejectedValue(new Error("SMTP offline"));

    const { POST } = await import("@/app/projects/[id]/threads/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Kickoff notes",
          bodyMarkdown: "Opening post"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(errorSpy).toHaveBeenCalledWith(
      "transactional_email_failed",
      expect.objectContaining({
        eventType: "thread_created",
        actorId: "user-1",
        projectId: "project-1",
        threadId: "thread-1",
        error: "SMTP offline"
      })
    );

    errorSpy.mockRestore();
  });

  it("does not send email when there are no recipients", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", name: "Blue Sky" });
    createThreadMock.mockResolvedValue({ id: "thread-1", title: "Kickoff notes" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([]);

    const { POST } = await import("@/app/projects/[id]/threads/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Kickoff notes",
          bodyMarkdown: "Opening post"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(sendThreadCreatedEmailMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the client is archived", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      name: "Blue Sky",
      client_id: "11111111-1111-1111-1111-111111111111"
    });
    assertClientNotArchivedForMutationMock.mockRejectedValue(
      new Error("Client archive is in progress. New discussions are temporarily disabled.")
    );

    const { POST } = await import("@/app/projects/[id]/threads/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: "Kickoff notes",
          bodyMarkdown: "Opening post"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Client archive is in progress. New discussions are temporarily disabled."
    });
    expect(assertClientNotArchivedForMutationMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({
        inProgress: "Client archive is in progress. New discussions are temporarily disabled."
      })
    );
    expect(createThreadMock).not.toHaveBeenCalled();
  });
});
