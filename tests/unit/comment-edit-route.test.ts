import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getCommentMock = vi.fn();
const editCommentMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getComment: getCommentMock,
  editComment: editCommentMock
}));

describe("PATCH /projects/[id]/threads/[threadId]/comments/[commentId]", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getCommentMock.mockReset();
    editCommentMock.mockReset();
  });

  it("returns 403 when a non-author tries to edit a comment", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getCommentMock.mockResolvedValue({ id: "comment-1", author_user_id: "user-2" });

    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/comments/[commentId]/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments/comment-1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ bodyMarkdown: "Updated copy" })
      }),
      {
        params: Promise.resolve({ id: "project-1", threadId: "thread-1", commentId: "comment-1" })
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Only the comment author can edit this comment"
    });
    expect(editCommentMock).not.toHaveBeenCalled();
  });

  it("allows the author to edit the comment", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getCommentMock.mockResolvedValue({ id: "comment-1", author_user_id: "user-1" });
    editCommentMock.mockResolvedValue({ id: "comment-1", body_markdown: "Updated copy" });

    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/comments/[commentId]/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments/comment-1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ bodyMarkdown: "Updated copy" })
      }),
      {
        params: Promise.resolve({ id: "project-1", threadId: "thread-1", commentId: "comment-1" })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      comment: { id: "comment-1", body_markdown: "Updated copy" }
    });
    expect(editCommentMock).toHaveBeenCalledWith({
      projectId: "project-1",
      threadId: "thread-1",
      commentId: "comment-1",
      bodyMarkdown: "Updated copy"
    });
  });
});
