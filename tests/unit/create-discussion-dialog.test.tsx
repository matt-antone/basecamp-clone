import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateDiscussionDialog } from "@/components/discussions/create-discussion-dialog";

describe("CreateDiscussionDialog", () => {
  it("renders discussion title input and editor slot", () => {
    const markup = renderToStaticMarkup(
      <CreateDiscussionDialog
        dialogRef={createRef<HTMLDialogElement>()}
        title="Roadmap"
        bodyMarkdown="Details"
        editor={<div className="editor-stub">Editor</div>}
        onTitleChange={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(markup).toContain('class="dialog dialogCreateDiscussion"');
    expect(markup).toContain('value="Roadmap"');
    expect(markup).toContain('class="editor-stub"');
    expect(markup).toContain(">Create<");
    expect(markup).toContain(">Cancel<");
  });

  it("renders attachmentsSlot when provided", () => {
    const markup = renderToStaticMarkup(
      <CreateDiscussionDialog
        dialogRef={createRef<HTMLDialogElement>()}
        title="X"
        bodyMarkdown="Y"
        editor={<div />}
        attachmentsSlot={<div className="attach-stub">Stub</div>}
        onTitleChange={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(markup).toContain("attach-stub");
  });

  it("disables Create when canSubmit is false", () => {
    const markup = renderToStaticMarkup(
      <CreateDiscussionDialog
        dialogRef={createRef<HTMLDialogElement>()}
        title="X"
        bodyMarkdown="Y"
        editor={<div />}
        canSubmit={false}
        onTitleChange={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Create</);
  });
});
