import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: () => {
    throw new Error("Missing bearer token");
  }
}));

async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(401);
  const body = (await response.json()) as { error?: string };
  expect(body.error ?? "").toMatch(/auth|token|workspace|unauthorized/i);
}

describe("user flow auth guards", () => {
  it("blocks unauthenticated thread and comment creation", async () => {
    const threadsRoute = await import("@/app/projects/[id]/threads/route");
    const commentsRoute = await import("@/app/projects/[id]/threads/[threadId]/comments/route");

    const createThreadResponse = await threadsRoute.POST(
      new Request("http://localhost/projects/project-1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Kickoff",
          bodyMarkdown: "Initial discussion."
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    await expectUnauthorized(createThreadResponse);

    const createCommentResponse = await commentsRoute.POST(
      new Request("http://localhost/projects/project-1/threads/thread-1/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: "Reply." })
      }),
      { params: Promise.resolve({ id: "project-1", threadId: "thread-1" }) }
    );
    await expectUnauthorized(createCommentResponse);
  });

  it("blocks unauthenticated file upload and download operations", async () => {
    const uploadInitRoute = await import("@/app/projects/[id]/files/upload-init/route");
    const uploadCompleteRoute = await import("@/app/projects/[id]/files/upload-complete/route");
    const downloadLinkRoute = await import("@/app/projects/[id]/files/[fileId]/download-link/route");

    const uploadInitResponse = await uploadInitRoute.POST(
      new Request("http://localhost/projects/project-1/files/upload-init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "spec.md",
          sizeBytes: 128,
          mimeType: "text/markdown"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    await expectUnauthorized(uploadInitResponse);

    const uploadCompleteResponse = await uploadCompleteRoute.POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "spec.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
          checksum: "d41d8cd98f00b204e9800998ecf8427e",
          contentBase64: "",
          sessionId: "session-1",
          targetPath: "/project-1/spec.md"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    await expectUnauthorized(uploadCompleteResponse);

    const downloadLinkResponse = await downloadLinkRoute.GET(
      new Request("http://localhost/projects/project-1/files/file-1/download-link"),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );
    await expectUnauthorized(downloadLinkResponse);
  });
});
