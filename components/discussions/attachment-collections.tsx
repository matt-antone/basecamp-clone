"use client";

import React from "react";
import { ThumbnailPreview, isThumbnailPreviewSupported } from "@/components/file-thumbnail-preview";
import { OneShotButton } from "@/components/one-shot-button";
import { formatBytes } from "@/lib/format-bytes";

type DiscussionAttachment = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_url?: string | null;
};

export function AttachmentCollections(props: {
  attachments: DiscussionAttachment[];
  projectId: string;
  token: string | null;
  onToken: (token: string | null) => void;
  onDownload: (fileId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { attachments, projectId, token, onToken, onDownload, onError } = props;
  const thumbnailAttachments = attachments.filter((attachment) =>
    isThumbnailPreviewSupported({ filename: attachment.filename, mimeType: attachment.mime_type })
  );
  const nonThumbnailAttachments = attachments.filter(
    (attachment) => !isThumbnailPreviewSupported({ filename: attachment.filename, mimeType: attachment.mime_type })
  );

  return (
    <>
      {thumbnailAttachments.length > 0 && (
        <ul className="commentAttachmentThumbGrid">
          {thumbnailAttachments.map((attachment) => (
            <li key={attachment.id} className="fileThumbItem commentAttachmentThumbItem">
              <OneShotButton
                type="button"
                className="fileThumbHitArea commentAttachmentThumbButton"
                onClick={() => onDownload(attachment.id).catch((error) => onError(error.message))}
              >
                <ThumbnailPreview
                  projectId={projectId}
                  fileId={attachment.id}
                  filename={attachment.filename}
                  mimeType={attachment.mime_type}
                  thumbnailUrl={attachment.thumbnail_url}
                  accessToken={token}
                  onToken={onToken}
                  alt={attachment.filename}
                  imageClassName="fileThumbImage"
                  fallback={<div className="fileThumbFallback">{getAttachmentBadgeLabel(attachment)}</div>}
                />
              </OneShotButton>
              <div className="fileThumbMeta">
                <OneShotButton
                  type="button"
                  className="fileDownloadButton"
                  onClick={() => onDownload(attachment.id).catch((error) => onError(error.message))}
                  title={attachment.filename}
                >
                  {attachment.filename}
                </OneShotButton>
                <small>{formatBytes(attachment.size_bytes)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {nonThumbnailAttachments.length > 0 && (
        <ul className="commentAttachmentList">
          {nonThumbnailAttachments.map((attachment) => (
            <li key={attachment.id} className="commentAttachmentItem">
              <OneShotButton
                type="button"
                className="fileDownloadButton"
                onClick={() => onDownload(attachment.id).catch((error) => onError(error.message))}
              >
                {attachment.filename}
              </OneShotButton>
              <small>{formatBytes(attachment.size_bytes)}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function getAttachmentBadgeLabel(attachment: DiscussionAttachment) {
  const mime = attachment.mime_type.toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "SHEET";
  if (mime.includes("word") || mime.includes("document")) return "DOC";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  const extension = attachment.filename.split(".").pop()?.trim().toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}
