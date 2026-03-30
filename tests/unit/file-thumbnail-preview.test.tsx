import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThumbnailPreview,
  buildThumbnailRoutePath,
  isThumbnailPreviewSupported,
  requestThumbnailPreview
} from "@/components/file-thumbnail-preview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thumbnail preview helpers", () => {
  it("builds the thumbnail route path with encoded ids", () => {
    expect(buildThumbnailRoutePath("project 1", "file/2")).toBe(
      "/projects/project%201/files/file%2F2/thumbnail"
    );
  });

  it("recognizes supported thumbnail preview files", () => {
    expect(isThumbnailPreviewSupported({ filename: "photo.png", mimeType: "image/png" })).toBe(true);
    expect(isThumbnailPreviewSupported({ filename: "report.pdf", mimeType: "application/octet-stream" })).toBe(true);
    expect(
      isThumbnailPreviewSupported({
        filename: "notes.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).toBe(true);
    expect(isThumbnailPreviewSupported({ filename: "notes.txt", mimeType: "text/plain" })).toBe(false);
  });

  it("parses 200 json responses as ready thumbnails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://thumbs.example.internal/thumbnails/file-1.jpg" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestThumbnailPreview({ projectId: "project-1", fileId: "file-1" })).resolves.toEqual({
      state: "ready",
      thumbnailUrl: "https://thumbs.example.internal/thumbnails/file-1.jpg"
    });
    expect(fetchMock).toHaveBeenCalledWith("/projects/project-1/files/file-1/thumbnail", expect.objectContaining({
      credentials: "same-origin"
    }));
  });

  it("parses queued responses and defaults poll timing when omitted", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestThumbnailPreview({ projectId: "project-1", fileId: "file-1" })).resolves.toEqual({
      state: "queued",
      pollAfterMs: 2000
    });
  });

  it("sends bearer token when provided", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "https://thumbs.example.internal/thumbnails/file-1.jpg" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestThumbnailPreview({ projectId: "project-1", fileId: "file-1", accessToken: "token-123" })
    ).resolves.toEqual({
      state: "ready",
      thumbnailUrl: "https://thumbs.example.internal/thumbnails/file-1.jpg"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/projects/project-1/files/file-1/thumbnail",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-123" }
      })
    );
  });

  it("refreshes the token and retries once on 401", async () => {
    const onToken = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(null, { status: 401 }))
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ accessToken: "fresh-token", status: "ok" }), { status: 200 })
      )
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ url: "https://thumbs.example.internal/thumbnails/file-1.jpg" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestThumbnailPreview({
        projectId: "project-1",
        fileId: "file-1",
        accessToken: "stale-token",
        onToken
      })
    ).resolves.toEqual({
      state: "ready",
      thumbnailUrl: "https://thumbs.example.internal/thumbnails/file-1.jpg"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/projects/project-1/files/file-1/thumbnail",
      expect.objectContaining({
        headers: { Authorization: "Bearer stale-token" }
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/auth/session",
      expect.objectContaining({
        credentials: "same-origin"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/projects/project-1/files/file-1/thumbnail",
      expect.objectContaining({
        headers: { Authorization: "Bearer fresh-token" }
      })
    );
    expect(onToken).toHaveBeenCalledWith("fresh-token");
  });
});

describe("ThumbnailPreview", () => {
  it("renders the provided thumbnail immediately when one already exists", () => {
    const markup = renderToStaticMarkup(
      <ThumbnailPreview
        projectId="project-1"
        fileId="file-1"
        filename="photo.png"
        mimeType="image/png"
        thumbnailUrl="https://thumbs.example.internal/thumbnails/file-1.jpg"
        alt="photo.png"
        fallback={<div className="fileThumbFallback">PNG</div>}
        imageClassName="fileThumbImage"
      />
    );

    expect(markup).toContain('class="fileThumbImage"');
    expect(markup).toContain('src="https://thumbs.example.internal/thumbnails/file-1.jpg"');
    expect(markup).not.toContain("fileThumbFallback");
  });

  it("renders fallback markup while waiting for a thumbnail", () => {
    const markup = renderToStaticMarkup(
      <ThumbnailPreview
        projectId="project-1"
        fileId="file-1"
        filename="report.pdf"
        mimeType="application/pdf"
        thumbnailUrl={null}
        alt="report.pdf"
        fallback={<div className="fileThumbFallback">PDF</div>}
        imageClassName="fileThumbImage"
      />
    );

    expect(markup).toContain('class="fileThumbFallback"');
    expect(markup).toContain(">PDF<");
  });
});
