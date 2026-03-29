import React from "react";
import { type ReactNode, type RefObject } from "react";
import { OneShotButton } from "@/components/one-shot-button";

export type CreateDiscussionDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  bodyMarkdown: string;
  editor: ReactNode;
  onTitleChange: (value: string) => void;
  onCreate: () => void;
  onCancel: () => void;
};

export function CreateDiscussionDialog(props: CreateDiscussionDialogProps) {
  const {
    dialogRef,
    title,
    bodyMarkdown,
    editor,
    onTitleChange,
    onCreate,
    onCancel
  } = props;

  return (
    <dialog ref={dialogRef} className="dialog dialogCreateDiscussion">
      <form method="dialog" className="dialogForm">
        <h3>Create Discussion</h3>
        <div className="form">
          <input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Discussion title" />
          {editor}
        </div>
        <div className="row">
          <OneShotButton type="button" onClick={onCreate} disabled={!title || !bodyMarkdown}>
            Create
          </OneShotButton>
          <OneShotButton type="button" className="secondary" onClick={onCancel}>
            Cancel
          </OneShotButton>
        </div>
      </form>
    </dialog>
  );
}
