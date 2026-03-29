"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { DiscussionComposer } from "@/components/discussions/discussion-composer";
import { InlineLoadingState, PageLoadingState } from "@/components/loading-shells";
import { OneShotButton } from "@/components/one-shot-button";
import { authedJsonFetch, ensureAccessToken, fetchAuthSession } from "@/lib/browser-auth";
import { createClientResource } from "@/lib/client-resource";
import { formatBytes } from "@/lib/format-bytes";
import { ThumbnailPreview, isThumbnailPreviewSupported } from "@/components/file-thumbnail-preview";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

const MarkdownEditor = dynamic(() => import("@/components/markdown-editor"), {
  ssr: false,
  loading: () => <InlineLoadingState label="Loading editor" message="Preparing the writing surface." />
});

type SessionUser = {
  id: string;
  email?: string;
};

type Comment = {
  id: string;
  body_markdown: string;
  body_html: string;
  created_at: string;
  edited_at: string | null;
  author_user_id: string;
  author_email: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
  attachments?: CommentAttachment[];
};

type CommentAttachment = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_url?: string | null;
  created_at: string;
};

type ThreadDetail = {
  id: string;
  title: string;
  body_html: string;
  starter_email?: string | null;
  starter_first_name?: string | null;
  starter_last_name?: string | null;
  comments: Comment[];
};

type PendingAttachment = {
  id: string;
  file: File;
  progress: number;
  stage: "queued" | "hashing" | "uploading" | "done" | "error";
  error?: string;
};

type DiscussionBootstrap = {
  currentUser: SessionUser | null;
  token: string | null;
  status: string;
  thread: ThreadDetail | null;
};

const discussionBootstrapResource = createClientResource(
  loadDiscussionBootstrap,
  ({ projectId, discussionId }) => `${projectId}:${discussionId}`
);

export default function DiscussionPage() {
  const params = useParams<{ id: string; discussion: string }>();
  const projectId = params?.id ?? "";
  const discussionId = params?.discussion ?? "";
  const [initial, setInitial] = useState<DiscussionBootstrap | null>(null);

  useEffect(() => {
    let cancelled = false;

    setInitial(null);
    discussionBootstrapResource.read({ projectId, discussionId }).then((nextState) => {
      if (!cancelled) {
        setInitial(nextState);
      }
    });

    return () => {
      cancelled = true;
      discussionBootstrapResource.clear({ projectId, discussionId });
    };
  }, [discussionId, projectId]);

  if (!initial) {
    return (
      <PageLoadingState
        label="Loading discussion"
        message="Bringing in the thread, comments, and attachments."
      />
    );
  }

  return <DiscussionPageContent projectId={projectId} discussionId={discussionId} initial={initial} />;
}

function DiscussionPageContent(props: {
  projectId: string;
  discussionId: string;
  initial: DiscussionBootstrap;
}) {
  const { projectId, discussionId, initial } = props;
  const [currentUser] = useState<SessionUser | null>(initial.currentUser);
  const [token, setToken] = useState(initial.token);
  const [status, setStatus] = useState(initial.status);
  const [thread, setThread] = useState<ThreadDetail | null>(initial.thread);
  const [commentBody, setCommentBody] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isAttachmentDragActive, setIsAttachmentDragActive] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [newCommentEditorKey, setNewCommentEditorKey] = useState(0);
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);

  async function authedFetch(accessToken: string, path: string, options: RequestInit = {}) {
    const { accessToken: nextToken, data } = await authedJsonFetch({
      accessToken,
      init: options,
      onToken: setToken,
      path
    });
    if (nextToken !== token) {
      setToken(nextToken);
    }
    return data;
  }

  async function load(accessToken: string, id: string, discussion: string) {
    const data = await authedFetch(accessToken, `/projects/${id}/threads/${discussion}`);
    setThread((data?.thread ?? null) as ThreadDetail | null);
    setStatus("Ready");
  }

  async function addComment() {
    if (!token || !projectId || !discussionId) return;
    const attachmentsToUpload = pendingAttachments.filter((attachment) => attachment.stage !== "done");
    let failedUploads = 0;
    const created = await authedFetch(token, `/projects/${projectId}/threads/${discussionId}/comments`, {
      method: "POST",
      body: JSON.stringify({ bodyMarkdown: commentBody })
    });
    const createdCommentId =
      created && typeof created === "object" && "comment" in created
        ? ((created.comment as { id?: string } | null | undefined)?.id ?? undefined)
        : undefined;
    if (createdCommentId && attachmentsToUpload.length > 0) {
      setIsUploadingAttachments(true);
      try {
        for (const attachment of attachmentsToUpload) {
          try {
            setPendingAttachmentState(attachment.id, { stage: "hashing", progress: 10, error: undefined });
            await uploadAttachmentForComment({
              token,
              onToken: setToken,
              projectId,
              threadId: discussionId,
              commentId: createdCommentId,
              file: attachment.file,
              onUploadProgress: (uploadProgress) =>
                setPendingAttachmentState(attachment.id, {
                  stage: "uploading",
                  progress: Math.max(20, Math.min(95, Math.round(20 + uploadProgress * 75)))
                })
            });
            setPendingAttachmentState(attachment.id, { stage: "done", progress: 100, error: undefined });
          } catch (error) {
            failedUploads += 1;
            setPendingAttachmentState(attachment.id, {
              stage: "error",
              error: error instanceof Error ? error.message : "Upload failed"
            });
          }
        }
        if (failedUploads > 0) {
          setStatus(`Comment saved. ${failedUploads} attachment(s) failed to upload.`);
        }
      } finally {
        setIsUploadingAttachments(false);
      }
    }
    setCommentBody("");
    if (failedUploads === 0) {
      setPendingAttachments([]);
    } else {
      setPendingAttachments((current) => current.filter((attachment) => attachment.stage === "error"));
    }
    if (commentFileInputRef.current && failedUploads === 0) {
      commentFileInputRef.current.value = "";
    }
    setNewCommentEditorKey((current) => current + 1);
    await load(token, projectId, discussionId);
  }

  async function saveEditedComment() {
    if (!token || !projectId || !discussionId || !editingCommentId || !editingBody.trim()) return;
    await authedFetch(token, `/projects/${projectId}/threads/${discussionId}/comments/${editingCommentId}`, {
      method: "PATCH",
      body: JSON.stringify({ bodyMarkdown: editingBody })
    });
    setEditingCommentId(null);
    setEditingBody("");
    await load(token, projectId, discussionId);
  }

  function startEditingComment(comment: Comment) {
    setEditingCommentId(comment.id);
    setEditingBody(comment.body_markdown);
  }

  async function openDownload(fileId: string) {
    if (!token || !projectId) return;
    const data = await authedFetch(token, `/projects/${projectId}/files/${fileId}/download-link`);
    const downloadUrl = typeof data?.url === "string" ? data.url : "";
    if (downloadUrl) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  }

  function setPendingAttachmentState(id: string, partial: Partial<PendingAttachment>) {
    setPendingAttachments((current) =>
      current.map((attachment) => (attachment.id === id ? { ...attachment, ...partial } : attachment))
    );
  }

  function addPendingFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) return;

    setPendingAttachments((current) => {
      const existingKeys = new Set(
        current.map((attachment) => `${attachment.file.name}:${attachment.file.size}:${attachment.file.lastModified}`)
      );
      const additions: PendingAttachment[] = [];
      for (const file of nextFiles) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (existingKeys.has(key)) {
          continue;
        }
        existingKeys.add(key);
        additions.push({
          id: crypto.randomUUID(),
          file,
          progress: 0,
          stage: "queued"
        });
      }
      return [...current, ...additions];
    });
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function getPersonLabel(person: {
    author_email?: string | null;
    author_first_name?: string | null;
    author_last_name?: string | null;
    starter_email?: string | null;
    starter_first_name?: string | null;
    starter_last_name?: string | null;
  }) {
    const firstName = (person.author_first_name ?? person.starter_first_name ?? "").trim();
    const lastName = (person.author_last_name ?? person.starter_last_name ?? "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || person.author_email || person.starter_email || "Team member";
  }

  function getPersonInitials(person: Parameters<typeof getPersonLabel>[0]) {
    const firstName = (person.author_first_name ?? person.starter_first_name ?? "").trim();
    const lastName = (person.author_last_name ?? person.starter_last_name ?? "").trim();
    if (firstName || lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "TM";
    }

    const emailLocal = (person.author_email ?? person.starter_email ?? "team.member").split("@")[0];
    const parts = emailLocal.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    }

    return emailLocal.slice(0, 2).toUpperCase() || "TM";
  }

  return (
    <main className="page">
      <header className="header">
        <h1>{thread?.title ?? "Discussion"}</h1>
        <div className="row">
          <Link href={`/${projectId}`} className="linkButton">
            Back to Project
          </Link>
          <Link href="/" className="linkButton secondaryLink">
            All Projects
          </Link>
        </div>
      </header>

      <p className="status">{status}</p>

      {thread && (
        <>
          <section className="discussionSection">
            <div className="discussionLeadMeta">
              <span className="discussionAvatarFallback" aria-hidden="true">
                {getPersonInitials(thread)}
              </span>
              <div className="discussionLeadMetaCopy">
                <strong>{getPersonLabel(thread)}</strong>
                <small>Started the thread</small>
              </div>
            </div>
            <div className="discussionRichText" dangerouslySetInnerHTML={{ __html: thread.body_html }} />
          </section>

          <section className="discussionSection">
            <ul className="discussionCommentList">
              {thread.comments.map((comment) => (
                <li key={comment.id} className="discussionCommentRow">
                  <span className="discussionAvatarFallback" aria-hidden="true">
                    {getPersonInitials(comment)}
                  </span>
                  <div className="projectMain">
                    <div className="discussionCommentHeader">
                      <div className="discussionCommentMeta">
                        <strong>{getPersonLabel(comment)}</strong>
                        <small>
                          {new Date(comment.created_at).toLocaleString()}
                          {comment.edited_at ? " (edited)" : ""}
                        </small>
                        {currentUser?.id === comment.author_user_id && editingCommentId !== comment.id && (
                          <OneShotButton type="button" className="terciary" onClick={() => startEditingComment(comment)}>
                            Edit
                          </OneShotButton>
                        )}
                      </div>
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="editorWrap">
                        <MarkdownEditor
                          key={`edit-${comment.id}`}
                          markdown={editingBody}
                          onChange={setEditingBody}
                          placeholder="Edit comment in markdown"
                        />
                        <div className="row">
                          <OneShotButton
                            onClick={() => saveEditedComment().catch((error) => setStatus(error.message))}
                            disabled={!editingBody.trim()}
                          >
                            Save
                          </OneShotButton>
                          <OneShotButton
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditingBody("");
                            }}
                          >
                            Cancel
                          </OneShotButton>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="discussionRichText" dangerouslySetInnerHTML={{ __html: comment.body_html }} />
                        {(comment.attachments?.length ?? 0) > 0 && (
                          <div className="commentAttachmentStack">
                            {comment.attachments?.some((attachment) =>
                              isThumbnailPreviewSupported({ filename: attachment.filename, mimeType: attachment.mime_type })
                            ) && (
                                <ul className="commentAttachmentThumbGrid">
                                  {comment.attachments
                                    ?.filter((attachment) =>
                                      isThumbnailPreviewSupported({
                                        filename: attachment.filename,
                                        mimeType: attachment.mime_type
                                      })
                                    )
                                    .map((attachment) => (
                                      <li key={attachment.id} className="fileThumbItem commentAttachmentThumbItem">
                                        <OneShotButton
                                          type="button"
                                          className="fileThumbHitArea commentAttachmentThumbButton"
                                          onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
                                        >
                                          <ThumbnailPreview
                                            projectId={projectId}
                                            fileId={attachment.id}
                                            filename={attachment.filename}
                                            mimeType={attachment.mime_type}
                                            thumbnailUrl={attachment.thumbnail_url}
                                            accessToken={token}
                                            onToken={setToken}
                                            alt={attachment.filename}
                                            imageClassName="fileThumbImage"
                                            fallback={<div className="fileThumbFallback">{getAttachmentBadgeLabel(attachment)}</div>}
                                          />
                                        </OneShotButton>
                                        <div className="fileThumbMeta">
                                          <OneShotButton
                                            type="button"
                                            className="fileDownloadButton"
                                            onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
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
                            {comment.attachments?.some(
                              (attachment) =>
                                !isThumbnailPreviewSupported({
                                  filename: attachment.filename,
                                  mimeType: attachment.mime_type
                                })
                            ) && (
                                <ul className="commentAttachmentList">
                                  {comment.attachments
                                    ?.filter(
                                      (attachment) =>
                                        !isThumbnailPreviewSupported({
                                          filename: attachment.filename,
                                          mimeType: attachment.mime_type
                                        })
                                    )
                                    .map((attachment) => (
                                      <li key={attachment.id} className="commentAttachmentItem">
                                        <OneShotButton
                                          type="button"
                                          className="fileDownloadButton"
                                          onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
                                        >
                                          {attachment.filename}
                                        </OneShotButton>
                                        <small>{formatBytes(attachment.size_bytes)}</small>
                                      </li>
                                    ))}
                                </ul>
                              )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <DiscussionComposer
            editor={(
              <MarkdownEditor
                key={`new-${newCommentEditorKey}`}
                markdown={commentBody}
                onChange={setCommentBody}
                placeholder="Reply in markdown"
              />
            )}
            commentFileInputRef={commentFileInputRef}
            pendingAttachments={pendingAttachments}
            isAttachmentDragActive={isAttachmentDragActive}
            isUploadingAttachments={isUploadingAttachments}
            canSubmit={Boolean(commentBody.trim()) && !isUploadingAttachments}
            submitLabel={isUploadingAttachments ? "Uploading..." : "Add Comment"}
            onSetAttachmentDragActive={setIsAttachmentDragActive}
            onAddPendingFiles={addPendingFiles}
            onRemovePendingAttachment={removePendingAttachment}
            onSubmit={() => addComment().catch((error) => setStatus(error.message))}
            formatAttachmentStage={formatAttachmentStage}
          />
        </>
      )}
    </main>
  );
}

async function uploadAttachmentForComment(args: {
  token: string;
  onToken: (token: string | null) => void;
  projectId: string;
  threadId: string;
  commentId: string;
  file: File;
  onUploadProgress: (value: number) => void;
}) {
  const { token, onToken, projectId, threadId, commentId, file, onUploadProgress } = args;
  const resolvedToken = await ensureAccessToken(token, onToken);
  const initResult = await authedJsonFetch({
    accessToken: resolvedToken,
    init: {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream"
      })
    },
    onToken,
    path: `/projects/${projectId}/files/upload-init`
  });
  const upload = initResult.data && "upload" in initResult.data ? initResult.data.upload : null;
  const sessionId =
    upload && typeof upload === "object" && "sessionId" in upload ? String(upload.sessionId ?? "") : "";
  const targetPath =
    upload && typeof upload === "object" && "targetPath" in upload ? String(upload.targetPath ?? "") : "";
  if (!sessionId || !targetPath) {
    throw new Error("Unable to initialize attachment upload");
  }

  await postFormDataWithUploadProgress({
    path: `/projects/${projectId}/files/upload-complete`,
    token: initResult.accessToken,
    body: (() => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", sessionId);
      formData.append("targetPath", targetPath);
      formData.append("threadId", threadId);
      formData.append("commentId", commentId);
      return formData;
    })(),
    onProgress: onUploadProgress
  });
}

function formatAttachmentStage(attachment: PendingAttachment) {
  if (attachment.stage === "queued") return "Queued";
  if (attachment.stage === "hashing") return "Preparing";
  if (attachment.stage === "uploading") return `${attachment.progress}%`;
  if (attachment.stage === "done") return "Uploaded";
  return "Failed";
}

function getAttachmentBadgeLabel(attachment: CommentAttachment) {
  const mime = attachment.mime_type.toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "SHEET";
  if (mime.includes("word") || mime.includes("document")) return "DOC";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  const extension = attachment.filename.split(".").pop()?.trim().toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}

async function postFormDataWithUploadProgress(args: {
  path: string;
  token: string;
  body: FormData;
  onProgress: (value: number) => void;
}) {
  return await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", args.path);
    xhr.setRequestHeader("Authorization", `Bearer ${args.token}`);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      args.onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    xhr.onerror = () => reject(new Error("Unable to upload attachment"));
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        args.onProgress(1);
        resolve();
        return;
      }
      const message =
        parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `Upload failed (${xhr.status})`;
      reject(new Error(message));
    };
    xhr.send(args.body);
  });
}

async function loadDiscussionBootstrap(params: {
  projectId: string;
  discussionId: string;
}): Promise<DiscussionBootstrap> {
  const { projectId, discussionId } = params;

  if (!projectId || !discussionId) {
    return {
      currentUser: null,
      token: null,
      status: "Loading discussion…",
      thread: null
    };
  }

  try {
    const session = await fetchAuthSession();
    const accessToken = session.accessToken;

    if (!accessToken) {
      return {
        currentUser: null,
        token: null,
        status: session.status || "Sign in first",
        thread: null
      };
    }

    const threadResponse = await authedJsonFetch({
      accessToken,
      path: `/projects/${projectId}/threads/${discussionId}`
    });
    return {
      currentUser: session.user,
      token: threadResponse.accessToken,
      status: session.status,
      thread: (threadResponse.data?.thread ?? null) as ThreadDetail | null
    };
  } catch (error) {
    return {
      currentUser: null,
      token: null,
      status: error instanceof Error ? error.message : "Load failed",
      thread: null
    };
  }
}
