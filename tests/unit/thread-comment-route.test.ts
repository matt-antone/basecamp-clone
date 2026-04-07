import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const createCommentMock = vi.fn();
const getUserProfileByIdMock = vi.fn();
const listNotificationRecipientsMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const sendCommentCreatedEmailMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
  getProject: getProjectMock,
  getThread: getThreadMock,
  createComment: createCommentMock,
  getUserProfileById: getUserProfileByIdMock,
  listNotificationRecipients: listNotificationRecipientsMock
}));

vi.mock("@/lib/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
  return {
    ...actual,
    sendCommentCreatedEmail: sendCommentCreatedEmailMock
  };
});

describe("POST /projects/[id]/threads/[threadId]/comments", () => {
  beforeEach(() => {
    vi.resetModules();
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getThreadMock.mockReset();
    createCommentMock.mockReset();
    getUserProfileByIdMock.mockReset();
    listNotificationRecipientsMock.mockReset();
    assertClientNotArchivedForMutationMock.mockReset();
    sendCommentCreatedEmailMock.mockReset();
  });

  it("returns 201 and sends email when comment creation succeeds", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", name: "Blue Sky" });
    getThreadMock.mockResolvedValue({
      id: "thread-1",
      title: "Kickoff notes"
    });
    createCommentMock.mockResolvedValue({ id: "comment-1" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([
      { id: "user-2", email: "jamie@example.com", firstName: "Jamie", lastName: "Teammate" }
    ]);
    sendCommentCreatedEmailMock.mockResolvedValue({ skipped: false, recipientCount: 1 });

    const { POST } = await import("@/app/projects/[id]/threads/[threadId]/comments/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bodyMarkdown: "This is a thoughtful follow-up comment."
        })
      }),
      { params: Promise.resolve({ id: "project-1", threadId: "thread-1" }) }
    );

    expect(response.status).toBe(201);
    expect(listNotificationRecipientsMock).toHaveBeenCalledWith();
    expect(sendCommentCreatedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { name: "Alex Author", email: "author@example.com" },
        project: expect.objectContaining({ id: "project-1", name: "Blue Sky" }),
        thread: { id: "thread-1", title: "Kickoff notes" },
        recipients: [{ email: "jamie@example.com", name: "Jamie Teammate" }],
        comment: {
          id: "comment-1",
          excerpt: "This is a thoughtful follow up comment."
        }
      })
    );
  });

  it("returns 201 and logs failure when email sending throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", name: "Blue Sky" });
    getThreadMock.mockResolvedValue({
      id: "thread-1",
      title: "Kickoff notes"
    });
    createCommentMock.mockResolvedValue({ id: "comment-1" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([
      { id: "user-2", email: "jamie@example.com", firstName: "Jamie", lastName: "Teammate" }
    ]);
    sendCommentCreatedEmailMock.mockRejectedValue(new Error("SMTP offline"));

    const { POST } = await import("@/app/projects/[id]/threads/[threadId]/comments/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bodyMarkdown: "This is a thoughtful follow-up comment."
        })
      }),
      { params: Promise.resolve({ id: "project-1", threadId: "thread-1" }) }
    );

    expect(response.status).toBe(201);
    expect(errorSpy).toHaveBeenCalledWith(
      "transactional_email_failed",
      expect.objectContaining({
        eventType: "comment_created",
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
    getThreadMock.mockResolvedValue({
      id: "thread-1",
      title: "Kickoff notes"
    });
    createCommentMock.mockResolvedValue({ id: "comment-1" });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-1",
      email: "author@example.com",
      first_name: "Alex",
      last_name: "Author"
    });
    listNotificationRecipientsMock.mockResolvedValue([]);

    const { POST } = await import("@/app/projects/[id]/threads/[threadId]/comments/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bodyMarkdown: "This is a thoughtful follow-up comment."
        })
      }),
      { params: Promise.resolve({ id: "project-1", threadId: "thread-1" }) }
    );

    expect(response.status).toBe(201);
    expect(sendCommentCreatedEmailMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the client is archived", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "author@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      name: "Blue Sky",
      client_id: "11111111-1111-1111-1111-111111111111"
    });
    getThreadMock.mockResolvedValue({
      id: "thread-1",
      title: "Kickoff notes"
    });
    assertClientNotArchivedForMutationMock.mockRejectedValue(
      new Error("Client is archived. Restore it before posting comments.")
    );

    const { POST } = await import("@/app/projects/[id]/threads/[threadId]/comments/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bodyMarkdown: "This is a thoughtful follow-up comment."
        })
      }),
      { params: Promise.resolve({ id: "project-1", threadId: "thread-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Client is archived. Restore it before posting comments."
    });
    expect(assertClientNotArchivedForMutationMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({
        archived: "Client is archived. Restore it before posting comments."
      })
    );
    expect(createCommentMock).not.toHaveBeenCalled();
  });
});
