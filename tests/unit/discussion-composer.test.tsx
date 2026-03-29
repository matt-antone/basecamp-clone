import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscussionComposer } from "@/components/discussions/discussion-composer";

describe("DiscussionComposer", () => {
  it("renders editor shell and attachment queue", () => {
    const pendingFile = new File(["mock"], "brief.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    const markup = renderToStaticMarkup(
      <DiscussionComposer
        editor={<div className="editor-stub">Editor</div>}
        commentFileInputRef={createRef<HTMLInputElement>()}
        pendingAttachments={[
          {
            id: "pending-1",
            file: pendingFile,
            progress: 35,
            stage: "uploading"
          }
        ]}
        isAttachmentDragActive={false}
        isUploadingAttachments={false}
        canSubmit={true}
        submitLabel="Add Comment"
        onSetAttachmentDragActive={vi.fn()}
        onAddPendingFiles={vi.fn()}
        onRemovePendingAttachment={vi.fn()}
        onSubmit={vi.fn()}
        formatAttachmentStage={() => "35%"}
      />
    );

    expect(markup).toContain('class="editor-stub"');
    expect(markup).toContain(">Attach files (optional)<");
    expect(markup).toContain(">brief.docx<");
    expect(markup).toContain("35%");
    expect(markup).toContain(">Add Comment<");
  });
});
