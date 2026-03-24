"use client";

import Link from "next/link";
import { ProjectTagList } from "@/components/project-tag-list";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Project = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  tags?: string[] | null;
  status?: string | null;
};

type Thread = {
  id: string;
  title: string;
  body_html: string;
  created_at: string;
  starter_email: string | null;
  starter_first_name: string | null;
  starter_last_name: string | null;
};

type ProjectFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";
  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading...");

  const [project, setProject] = useState<Project | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filePreviewUrls, setFilePreviewUrls] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const createDiscussionDialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    try {
      setSupabase(getSupabaseBrowserClient());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supabase init failed");
    }
  }, []);

  async function authedFetch(accessToken: string, path: string, options: RequestInit = {}) {
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

  async function load(accessToken: string, id: string) {
    const [projectRes, threadsRes, filesRes] = await Promise.all([
      authedFetch(accessToken, `/projects/${id}`),
      authedFetch(accessToken, `/projects/${id}/threads`),
      authedFetch(accessToken, `/projects/${id}/files`)
    ]);
    setProject(projectRes.project);
    setThreads(threadsRes.threads ?? []);
    setFiles(filesRes.files ?? []);
  }

  useEffect(() => {
    if (!supabase || !projectId) return;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;
      if (!accessToken) {
        setStatus("Sign in first");
        return;
      }
      setToken(accessToken);
      await load(accessToken, projectId);
      setStatus("Ready");
    };

    init().catch((error) => setStatus(error instanceof Error ? error.message : "Load failed"));
  }, [supabase, projectId]);

  useEffect(() => {
    previewUrlsRef.current = filePreviewUrls;
  }, [filePreviewUrls]);

  useEffect(() => {
    setFilePreviewUrls((current) => {
      const next: Record<string, string> = {};
      let changed = false;
      Object.entries(current).forEach(([id, url]) => {
        if (files.some((file) => file.id === id)) {
          next[id] = url;
        } else {
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [files]);

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
    if (!token || !projectId) return;

    const imageFiles = files.filter((file) => file.mime_type.toLowerCase().startsWith("image/"));
    let canceled = false;

    async function loadPreviews() {
      const pending = imageFiles.filter((file) => !previewUrlsRef.current[file.id]);
      if (!pending.length) {
        return;
      }

      const previewEntries = await Promise.all(
        pending.map(async (file) => {
          try {
            const response = await fetch(`/projects/${projectId}/files/${file.id}/thumbnail?size=w640h480`, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              }
            });
            if (!response.ok) {
              return [file.id, ""] as const;
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            return [file.id, objectUrl] as const;
          } catch {
            return [file.id, ""] as const;
          }
        })
      );

      if (canceled) return;
      setFilePreviewUrls((current) => {
        const next: Record<string, string> = {};
        let changed = false;
        Object.entries(current).forEach(([id, url]) => {
          if (files.some((file) => file.id === id)) {
            next[id] = url;
          }
        });
        previewEntries.forEach(([id, url]) => {
          if (url) {
            if (next[id] && next[id] !== url && next[id].startsWith("blob:")) {
              URL.revokeObjectURL(next[id]);
            }
            if (next[id] !== url) changed = true;
            next[id] = url;
          }
        });
        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(next);
        if (!changed && currentKeys.length === nextKeys.length && currentKeys.every((key) => next[key] === current[key])) {
          return current;
        }
        return next;
      });
    }

    loadPreviews().catch(() => {
      /* Preview loading failures should not block page use. */
    });

    return () => {
      canceled = true;
    };
  }, [files, token, projectId]);

  function getStarterLabel(thread: Thread) {
    const fullName = `${thread.starter_first_name ?? ""} ${thread.starter_last_name ?? ""}`.trim();
    return fullName || thread.starter_email || "Starter";
  }

  function getStarterInitials(thread: Thread) {
    const first = (thread.starter_first_name ?? "").trim();
    const last = (thread.starter_last_name ?? "").trim();
    if (first || last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "S";
    }

    const emailLocalPart = (thread.starter_email ?? "starter").split("@")[0];
    const emailWords = emailLocalPart.split(/[._\-\s]+/).filter(Boolean);
    if (emailWords.length >= 2) {
      return `${emailWords[0].charAt(0)}${emailWords[1].charAt(0)}`.toUpperCase();
    }

    return emailLocalPart.slice(0, 2).toUpperCase() || "S";
  }

  async function createDiscussion() {
    if (!token || !projectId) return;
    await authedFetch(token, `/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ title, bodyMarkdown })
    });
    setTitle("");
    setBodyMarkdown("");
    createDiscussionDialogRef.current?.close();
    await load(token, projectId);
  }

  async function uploadSelectedFile() {
    if (!token || !projectId || !selectedFile) return;
    setIsUploading(true);
    try {
      const init = await authedFetch(token, `/projects/${projectId}/files/upload-init`, {
        method: "POST",
        body: JSON.stringify({
          filename: selectedFile.name,
          sizeBytes: selectedFile.size,
          mimeType: selectedFile.type || "application/octet-stream"
        })
      });

      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("sessionId", init.upload.sessionId);
      formData.append("targetPath", init.upload.targetPath);

      await authedMultipartFetch(token, `/projects/${projectId}/files/upload-complete`, formData);

      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await load(token, projectId);
      setStatus(`Uploaded ${selectedFile.name}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function downloadFile(fileId: string) {
    if (!token || !projectId) return;
    const data = await authedFetch(token, `/projects/${projectId}/files/${fileId}/download-link`);
    if (typeof data.url === "string" && data.url.length > 0) {
      window.open(data.url, "_blank", "noopener,noreferrer");
    }
  }

  function handleFileInputSelection(list: FileList | null) {
    setSelectedFile(list?.[0] ?? null);
  }

  async function authedMultipartFetch(accessToken: string, path: string, body: FormData) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Request failed");
    }
    return data;
  }

  function normalizeProjectColumn(projectRecord: Project | null): "new" | "in_progress" | "blocked" | "complete" {
    const value = (projectRecord?.status ?? "new").toLowerCase();
    if (value === "in_progress" || value === "in progress") return "in_progress";
    if (value === "blocked") return "blocked";
    if (value === "complete" || value === "completed") return "complete";
    return "new";
  }

  return (
    <main className="page">
      <header className="header">
        <div className={`projectHeaderCopy projectStatusTone tone-${normalizeProjectColumn(project)}`}>
          <h1>{project?.display_name ?? project?.name ?? "Project"}</h1>
          <ProjectTagList tags={project?.tags} className="projectHeaderTags" />
        </div>
        <div className="row">
          <Link href="/" className="linkButton">
            All Projects
          </Link>
          <Link href="/settings" className="iconButton" aria-label="Settings">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.66 7.66 0 0 0 .05-.94 7.66 7.66 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94L2.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </Link>
        </div>
      </header>

      <p className="status">{status}</p>

      <section className="stackSection">
        <div className="sectionHeader">
          <h2>Discussions</h2>
          <button
            className="iconButton"
            aria-label="Create discussion"
            onClick={() => createDiscussionDialogRef.current?.showModal()}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
            </svg>
          </button>
        </div>
        <ul>
          {threads.map((thread) => (
            <li key={thread.id} className="projectRow">
              <span className="discussionAvatarFallback" aria-label={`${getStarterLabel(thread)} initials`}>
                {getStarterInitials(thread)}
              </span>
              <div className="projectMain">
                <Link href={`/${projectId}/${thread.id}`} className="projectLink">
                  {thread.title}
                </Link>
                <small>{new Date(thread.created_at).toLocaleString()}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="stackSection filesSection">
        <div className="sectionHeader">
          <div className="sectionHeaderTitle">
            <h2>Files</h2>
            <a
              href={`/projects/${projectId}/folder-link`}
              className="filesFolderLink"
              target="_blank"
              rel="noreferrer"
            >
              Open Dropbox folder
            </a>
          </div>
          <small className="filesCount">{files.length} total</small>
        </div>

        <ul className="fileThumbGrid">
          <li className="fileThumbItem fileThumbUploadItem">
            <div className="commentUploadArea fileUploadArea fileThumbUploadArea">
              {/* <label className="commentFileLabel">Upload file</label> */}
              <input
                ref={fileInputRef}
                type="file"
                className="commentFileInputHidden"
                onChange={(event) => handleFileInputSelection(event.target.files)}
              />
              <div
                className={`commentDropZone fileThumbUploadDropZone ${isFileDragActive ? "commentDropZoneActive" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsFileDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsFileDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsFileDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsFileDragActive(false);
                  handleFileInputSelection(event.dataTransfer.files);
                }}
              >
                <p className="commentDropZoneTitle">Drop a file here</p>
                <p className="commentDropZoneSubtle">or click to browse</p>
              </div>
              {selectedFile && (
                <ul className="commentUploadQueue">
                  <li className="commentUploadQueueItem">
                    <div className="commentUploadQueueHead">
                      <span>{selectedFile.name}</span>
                      <small>{formatBytes(selectedFile.size)} • ready to upload</small>
                    </div>
                    {!isUploading && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedFile(null);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = "";
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                </ul>
              )}
              <button
                type="button"
                onClick={() => uploadSelectedFile().catch((error) => setStatus(error.message))}
                disabled={!selectedFile || isUploading}
              >
                {isUploading ? "Uploading..." : "Upload File"}
              </button>
            </div>
          </li>
          {files.map((file) => {
            const isImage = file.mime_type.toLowerCase().startsWith("image/");
            const previewUrl = filePreviewUrls[file.id];
            return (
              <li key={file.id} className="fileThumbItem">
                <button
                  type="button"
                  className="fileThumbHitArea"
                  onClick={() => downloadFile(file.id).catch((error) => setStatus(error.message))}
                >
                  {isImage && previewUrl ? (
                    <img src={previewUrl} alt={file.filename} className="fileThumbImage" loading="lazy" />
                  ) : (
                    <div className="fileThumbFallback">{getFileBadgeLabel(file)}</div>
                  )}
                </button>
                <div className="fileThumbMeta">
                  <button
                    type="button"
                    className="fileDownloadButton"
                    onClick={() => downloadFile(file.id).catch((error) => setStatus(error.message))}
                    title={file.filename}
                  >
                    {file.filename}
                  </button>
                  <small>
                    {formatBytes(file.size_bytes)} • {new Date(file.created_at).toLocaleDateString()}
                  </small>
                </div>
              </li>
            );
          })}
          {files.length === 0 && <li className="emptyProjectsText fileThumbEmptyState">No files yet. Upload one to start your project workspace.</li>}
        </ul>
      </section>

      <dialog ref={createDiscussionDialogRef} className="dialog">
        <form method="dialog" className="dialogForm">
          <h3>Create Discussion</h3>
          <div className="form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discussion title" />
            <textarea value={bodyMarkdown} onChange={(e) => setBodyMarkdown(e.target.value)} placeholder="Markdown body" />
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => createDiscussion().catch((error) => setStatus(error.message))}
              disabled={!title || !bodyMarkdown}
            >
              Create
            </button>
            <button type="button" className="secondary" onClick={() => createDiscussionDialogRef.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

function getFileBadgeLabel(file: ProjectFile) {
  const mime = file.mime_type.toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "SHEET";
  if (mime.includes("word") || mime.includes("document")) return "DOC";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  const extension = file.filename.split(".").pop()?.trim().toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
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
