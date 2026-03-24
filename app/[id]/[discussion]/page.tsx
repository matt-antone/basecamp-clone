"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { InlineLoadingState, PageLoadingState } from "@/components/loading-shells";
import { createClientResource } from "@/lib/client-resource";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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
  const token = initial.token;
  const [status, setStatus] = useState(initial.status);
  const [thread, setThread] = useState<ThreadDetail | null>(initial.thread);
  const [commentBody, setCommentBody] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isAttachmentDragActive, setIsAttachmentDragActive] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [newCommentEditorKey, setNewCommentEditorKey] = useState(0);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({});
  const commentFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});

  async function authedFetch(accessToken: string, path: string, options: RequestInit = {}) {
    return authedFetchDiscussion(accessToken, path, options);
  }

  async function load(accessToken: string, id: string, discussion: string) {
    const data = await authedFetch(accessToken, `/projects/${id}/threads/${discussion}`);
    setThread(data.thread ?? null);
    setStatus("Ready");
  }

  useEffect(() => {
    previewUrlsRef.current = attachmentPreviewUrls;
  }, [attachmentPreviewUrls]);

  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, []);

  useEffect(() => {
    const attachmentIds = new Set(
      (thread?.comments ?? [])
        .flatMap((comment) => comment.attachments ?? [])
        .map((attachment) => attachment.id)
    );

    setAttachmentPreviewUrls((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      Object.entries(current).forEach(([id, url]) => {
        if (attachmentIds.has(id)) {
          next[id] = url;
          return;
        }

        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
        changed = true;
      });

      return changed ? next : current;
    });
  }, [thread]);

  useEffect(() => {
    if (!thread || !token || !projectId) return;

    const imageAttachments = thread.comments
      .flatMap((comment) => comment.attachments ?? [])
      .filter((attachment) => isImageAttachment(attachment.mime_type));
    const pending = imageAttachments.filter((attachment) => !previewUrlsRef.current[attachment.id]);
    if (!pending.length) {
      return;
    }

    let canceled = false;

    async function loadPreviews() {
      const previewEntries = await Promise.all(
        pending.map(async (attachment) => {
          try {
            const response = await fetch(`/projects/${projectId}/files/${attachment.id}/thumbnail?size=w256h256`, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              }
            });
            if (!response.ok) {
              return [attachment.id, ""] as const;
            }
            const blob = await response.blob();
            return [attachment.id, URL.createObjectURL(blob)] as const;
          } catch {
            return [attachment.id, ""] as const;
          }
        })
      );

      if (canceled) {
        previewEntries.forEach(([, url]) => {
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
        });
        return;
      }

      setAttachmentPreviewUrls((current) => {
        const next = { ...current };
        let changed = false;

        previewEntries.forEach(([id, url]) => {
          if (!url) return;
          if (next[id] && next[id] !== url && next[id].startsWith("blob:")) {
            URL.revokeObjectURL(next[id]);
          }
          if (next[id] !== url) {
            next[id] = url;
            changed = true;
          }
        });

        return changed ? next : current;
      });
    }

    loadPreviews().catch(() => {
      /* Thumbnail failures should not block discussion use. */
    });

    return () => {
      canceled = true;
    };
  }, [thread, token, projectId]);

  async function addComment() {
    if (!token || !projectId || !discussionId) return;
    const attachmentsToUpload = pendingAttachments.filter((attachment) => attachment.stage !== "done");
    let failedUploads = 0;
    const created = await authedFetch(token, `/projects/${projectId}/threads/${discussionId}/comments`, {
      method: "POST",
      body: JSON.stringify({ bodyMarkdown: commentBody })
    });
    const createdCommentId = created.comment?.id as string | undefined;
    if (createdCommentId && attachmentsToUpload.length > 0) {
      setIsUploadingAttachments(true);
      try {
        for (const attachment of attachmentsToUpload) {
          try {
            setPendingAttachmentState(attachment.id, { stage: "hashing", progress: 10, error: undefined });
            await uploadAttachmentForComment({
              token,
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
    if (typeof data.url === "string" && data.url.length > 0) {
      window.open(data.url, "_blank", "noopener,noreferrer");
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
                          <button type="button" className="terciary" onClick={() => startEditingComment(comment)}>
                            Edit
                          </button>
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
                          <button
                            onClick={() => saveEditedComment().catch((error) => setStatus(error.message))}
                            disabled={!editingBody.trim()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditingBody("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="discussionRichText" dangerouslySetInnerHTML={{ __html: comment.body_html }} />
                        {(comment.attachments?.length ?? 0) > 0 && (
                          <div className="commentAttachmentStack">
                            {comment.attachments?.some((attachment) => isImageAttachment(attachment.mime_type)) && (
                              <ul className="commentAttachmentThumbGrid">
                                {comment.attachments
                                  ?.filter((attachment) => isImageAttachment(attachment.mime_type))
                                  .map((attachment) => (
                                    <li key={attachment.id} className="fileThumbItem commentAttachmentThumbItem">
                                      <button
                                        type="button"
                                        className="fileThumbHitArea commentAttachmentThumbButton"
                                        onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
                                      >
                                        {attachmentPreviewUrls[attachment.id] ? (
                                          <img
                                            src={attachmentPreviewUrls[attachment.id]}
                                            alt={attachment.filename}
                                            className="fileThumbImage"
                                            loading="lazy"
                                          />
                                        ) : (
                                          <div className="fileThumbFallback">{getAttachmentBadgeLabel(attachment)}</div>
                                        )}
                                      </button>
                                      <div className="fileThumbMeta">
                                        <button
                                          type="button"
                                          className="fileDownloadButton"
                                          onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
                                          title={attachment.filename}
                                        >
                                          {attachment.filename}
                                        </button>
                                        <small>{formatBytes(attachment.size_bytes)}</small>
                                      </div>
                                    </li>
                                  ))}
                              </ul>
                            )}
                            {comment.attachments?.some((attachment) => !isImageAttachment(attachment.mime_type)) && (
                              <ul className="commentAttachmentList">
                                {comment.attachments
                                  ?.filter((attachment) => !isImageAttachment(attachment.mime_type))
                                  .map((attachment) => (
                                    <li key={attachment.id} className="commentAttachmentItem">
                                      <button
                                        type="button"
                                        className="fileDownloadButton"
                                        onClick={() => openDownload(attachment.id).catch((error) => setStatus(error.message))}
                                      >
                                        {attachment.filename}
                                      </button>
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
          <section className="discussionSection">
            <h2>Add Comment</h2>
            <div className="form editorWrap">
              <MarkdownEditor
                key={`new-${newCommentEditorKey}`}
                markdown={commentBody}
                onChange={setCommentBody}
                placeholder="Reply in markdown"
              />
              <div className="commentUploadArea">
                <label className="commentFileLabel">Attach files (optional)</label>
                <input
                  ref={commentFileInputRef}
                  type="file"
                  multiple
                  className="commentFileInputHidden"
                  onChange={(event) => addPendingFiles(event.target.files ?? [])}
                />
                <div
                  className={`commentDropZone ${isAttachmentDragActive ? "commentDropZoneActive" : ""}`}
                  onClick={() => commentFileInputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsAttachmentDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsAttachmentDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setIsAttachmentDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsAttachmentDragActive(false);
                    addPendingFiles(event.dataTransfer.files);
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
                          <button
                            type="button"
                            className="secondary"
                            onClick={(event) => {
                              event.stopPropagation();
                              removePendingAttachment(attachment.id);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={() => addComment().catch((error) => setStatus(error.message))}
                disabled={!commentBody.trim() || isUploadingAttachments}
              >
                {isUploadingAttachments ? "Uploading..." : "Add Comment"}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

async function uploadAttachmentForComment(args: {
  token: string;
  projectId: string;
  threadId: string;
  commentId: string;
  file: File;
  onUploadProgress: (value: number) => void;
}) {
  const { token, projectId, threadId, commentId, file, onUploadProgress } = args;
  const initResponse = await fetch(`/projects/${projectId}/files/upload-init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream"
    })
  });
  const initPayload = await initResponse.json();
  if (!initResponse.ok) {
    throw new Error(initPayload.error ?? "Unable to initialize attachment upload");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("sessionId", initPayload.upload.sessionId);
  formData.append("targetPath", initPayload.upload.targetPath);
  formData.append("threadId", threadId);
  formData.append("commentId", commentId);
  await postFormDataWithUploadProgress({
    path: `/projects/${projectId}/files/upload-complete`,
    token,
    body: formData,
    onProgress: onUploadProgress
  });
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatAttachmentStage(attachment: PendingAttachment) {
  if (attachment.stage === "queued") return "Queued";
  if (attachment.stage === "hashing") return "Preparing";
  if (attachment.stage === "uploading") return `${attachment.progress}%`;
  if (attachment.stage === "done") return "Uploaded";
  return "Failed";
}

function isImageAttachment(mimeType: string) {
  return mimeType.toLowerCase().startsWith("image/");
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

async function authedFetchDiscussion(accessToken: string, path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
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
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token ?? null;

    if (!accessToken) {
      return {
        currentUser: null,
        token: null,
        status: "Sign in first",
        thread: null
      };
    }

    const threadResponse = await authedFetchDiscussion(accessToken, `/projects/${projectId}/threads/${discussionId}`);
    return {
      currentUser: data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null,
      token: accessToken,
      status: "Ready",
      thread: (threadResponse.thread ?? null) as ThreadDetail | null
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
