import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttachmentCollections } from "@/components/discussions/attachment-collections";

describe("AttachmentCollections", () => {
  it("renders thumbnail and non-thumbnail attachment groups", () => {
    const markup = renderToStaticMarkup(
      <AttachmentCollections
        attachments={[
          {
            id: "file-thumb",
            filename: "photo.jpg",
            mime_type: "image/jpeg",
            size_bytes: 1024,
            thumbnail_url: "https://example.com/thumb.jpg"
          },
          {
            id: "file-zip",
            filename: "archive.zip",
            mime_type: "application/zip",
            size_bytes: 2048
          }
        ]}
        projectId="project-1"
        token={null}
        onToken={vi.fn()}
        onDownload={async () => undefined}
        onError={vi.fn()}
      />
    );

    expect(markup).toContain("commentAttachmentThumbGrid");
    expect(markup).toContain("commentAttachmentList");
    expect(markup).toContain("photo.jpg");
    expect(markup).toContain("archive.zip");
  });
});
