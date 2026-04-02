import React from "react";
import { type ReactNode, type RefObject } from "react";
import { OneShotButton } from "@/components/one-shot-button";
import { formatBytes } from "@/lib/format-bytes";

type PendingAttachment = {
  id: string;
  file: File;
  progress: number;
  stage: "queued" | "hashing" | "uploading" | "done" | "error";
  error?: string;
};

export type DiscussionComposerProps = {
  editor: ReactNode;
  commentFileInputRef: RefObject<HTMLInputElement | null>;
  pendingAttachments: PendingAttachment[];
  isAttachmentDragActive: boolean;
  isUploadingAttachments: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onSetAttachmentDragActive: (next: boolean) => void;
  onAddPendingFiles: (files: FileList | File[]) => void;
  onRemovePendingAttachment: (id: string) => void;
  onSubmit: () => void;
  formatAttachmentStage: (attachment: PendingAttachment) => string;
};

export function DiscussionComposer(props: DiscussionComposerProps) {
  const {
    editor,
    commentFileInputRef,
    pendingAttachments,
    isAttachmentDragActive,
    isUploadingAttachments,
    canSubmit,
    submitLabel,
    onSetAttachmentDragActive,
    onAddPendingFiles,
    onRemovePendingAttachment,
    onSubmit,
    formatAttachmentStage
  } = props;

  return (
    <section className="discussionSection">
      <h2>Add Comment</h2>
      <div className="form editorWrap">
        {editor}
        <div className="commentUploadArea">
          <label className="commentFileLabel">Attach files (optional)</label>
          <input
            ref={commentFileInputRef}
            type="file"
            multiple
            className="commentFileInputHidden"
            onChange={(event) => onAddPendingFiles(event.target.files ?? [])}
          />
          <div
            className={`commentDropZone ${isAttachmentDragActive ? "commentDropZoneActive" : ""}`}
            onClick={() => commentFileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              onSetAttachmentDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              onSetAttachmentDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              onSetAttachmentDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              onSetAttachmentDragActive(false);
              onAddPendingFiles(event.dataTransfer.files);
            }}
          >
            <p className="commentDropZoneTitle">Drag files here</p>
            <p className="commentDropZoneSubtle">or click to browse from your device</p>
          </div>
          {pendingAttachments.length > 0 && (
            <ul className="commentUploadQueue">
              {pendingAttachments.map((attachment) => (
                <li key={attachment.id} className="commentUploadQueueItem">
                  <div className="commentUploadQueueHead">
                    <span>{attachment.file.name}</span>
                    <small>
                      {formatBytes(attachment.file.size)} • {formatAttachmentStage(attachment)}
                    </small>
                  </div>
                  <div className="commentUploadProgressTrack" aria-hidden="true">
                    <span className="commentUploadProgressFill" style={{ width: `${attachment.progress}%` }} />
                  </div>
                  {attachment.error && <small className="commentUploadError">{attachment.error}</small>}
                  {!isUploadingAttachments && (
                    <OneShotButton
                      type="button"
                      className="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemovePendingAttachment(attachment.id);
                      }}
                    >
                      Remove
                    </OneShotButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <OneShotButton onClick={onSubmit} disabled={!canSubmit}>
        {submitLabel}
      </OneShotButton>
    </section>
  );
}
