"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { InlineLoadingState, PageLoadingState } from "@/components/loading-shells";
import { ProjectDialogForm, type ProjectDialogValues } from "@/components/project-dialog-form";
import { ProjectTagList } from "@/components/project-tag-list";
import { getAvatarProxyUrl } from "@/lib/avatar";
import { authedFormDataFetch, authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import { createClientResource } from "@/lib/client-resource";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

const MarkdownEditor = dynamic(() => import("@/components/markdown-editor"), {
  ssr: false,
  loading: () => <InlineLoadingState label="Loading editor" message="Preparing the writing surface." />
});

type Project = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  deadline?: string | null;
  tags?: string[] | null;
  status?: string | null;
  archived?: boolean;
  client_id: string | null;
  client_name?: string | null;
  client_code?: string | null;
  requestor?: string | null;
  my_hours?: number | string | null;
};

type ProjectUserHoursEntry = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  hours: number | string;
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

type ClientRecord = {
  id: string;
  name: string;
  code: string;
};

type ViewerProfile = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type ProjectPageBootstrap = {
  token: string | null;
  status: string;
  project: Project | null;
  userHours: ProjectUserHoursEntry[];
  clients: ClientRecord[];
  viewerProfile: ViewerProfile | null;
  threads: Thread[];
  files: ProjectFile[];
};

const projectBootstrapResource = createClientResource(loadProjectBootstrap, (projectId) => projectId);

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";
  const [initial, setInitial] = useState<ProjectPageBootstrap | null>(null);

  useEffect(() => {
    let cancelled = false;

    setInitial(null);
    projectBootstrapResource.read(projectId).then((nextState) => {
      if (!cancelled) {
        setInitial(nextState);
      }
    });

    return () => {
      cancelled = true;
      projectBootstrapResource.clear(projectId);
    };
  }, [projectId]);

  if (!initial) {
    return (
      <PageLoadingState
        label="Loading project"
        message="Pulling together project details, discussions, and files."
      />
    );
  }

  return <ProjectPageContent projectId={projectId} initial={initial} />;
}

function ProjectPageContent({ projectId, initial }: { projectId: string; initial: ProjectPageBootstrap }) {
  const [token, setToken] = useState(initial.token);
  const [status, setStatus] = useState(initial.status);

  const [project, setProject] = useState<Project | null>(initial.project);
  const [userHours, setUserHours] = useState<ProjectUserHoursEntry[]>(initial.userHours);
  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(initial.viewerProfile);
  const [threads, setThreads] = useState<Thread[]>(initial.threads);
  const [files, setFiles] = useState<ProjectFile[]>(initial.files);
  const [filePreviewUrls, setFilePreviewUrls] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingMyHours, setIsSavingMyHours] = useState(false);
  const [isRestoringProject, setIsRestoringProject] = useState(false);
  const [savingArchivedHoursUserId, setSavingArchivedHoursUserId] = useState<string | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectDialogValues>(createProjectDialogValues());
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [myHoursInput, setMyHoursInput] = useState("");
  const [archivedHoursInputs, setArchivedHoursInputs] = useState<Record<string, string>>({});
  const [createDiscussionEditorKey, setCreateDiscussionEditorKey] = useState(0);
  const editProjectDialogRef = useRef<HTMLDialogElement | null>(null);
  const createDiscussionDialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});

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

  async function load(accessToken: string, id: string) {
    const nextState = await loadProjectData(accessToken, id);
    setProject(nextState.project);
    setUserHours(nextState.userHours);
    setThreads(nextState.threads);
    setFiles(nextState.files);
    setClients(nextState.clients);
    setViewerProfile(nextState.viewerProfile);
    setStatus("Ready");
  }

  useEffect(() => {
    setProjectForm(createProjectDialogValues(project?.client_id ?? "", project));
    setMyHoursInput(formatHoursInput(project?.my_hours));
  }, [project]);

  useEffect(() => {
    setArchivedHoursInputs(
      Object.fromEntries(userHours.map((entry) => [entry.userId, formatHoursInput(entry.hours)]))
    );
  }, [userHours]);

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
    setCreateDiscussionEditorKey((current) => current + 1);
    createDiscussionDialogRef.current?.close();
    await load(token, projectId);
  }

  async function saveProject() {
    if (!token || !projectId || !project || !project.client_id) return;

    setIsSavingProject(true);
    try {
      await authedFetch(token, `/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: projectForm.name,
          description: projectForm.description,
          deadline: projectForm.deadline || null,
          clientId: project.client_id,
          tags: parseProjectTags(projectForm.tags),
          requestor: projectForm.requestor.trim() || null
        })
      });
      await load(token, projectId);
      editProjectDialogRef.current?.close();
      setStatus("Project updated");
    } finally {
      setIsSavingProject(false);
    }
  }

  async function saveMyHours() {
    if (!token || !projectId) return;

    const trimmedHours = myHoursInput.trim();
    const parsedHours = trimmedHours ? Number(trimmedHours) : Number.NaN;
    if (trimmedHours && (!Number.isFinite(parsedHours) || parsedHours < 0)) {
      throw new Error("My hours must be a non-negative number");
    }

    setIsSavingMyHours(true);
    try {
      const data = await authedFetch(token, `/projects/${projectId}/my-hours`, {
        method: "PATCH",
        body: JSON.stringify({
          hours: trimmedHours ? parsedHours : null
        })
      });
      setProject((data?.project ?? null) as Project | null);
      setStatus("My hours saved");
    } finally {
      setIsSavingMyHours(false);
    }
  }

  async function saveArchivedHours(userId: string) {
    if (!token || !projectId) return;

    const inputValue = (archivedHoursInputs[userId] ?? "").trim();
    const parsedHours = inputValue ? Number(inputValue) : Number.NaN;
    if (inputValue && (!Number.isFinite(parsedHours) || parsedHours < 0)) {
      throw new Error("Team hours must be a non-negative number");
    }

    setSavingArchivedHoursUserId(userId);
    try {
      const data = await authedFetch(token, `/projects/${projectId}/archived-hours`, {
        method: "PATCH",
        body: JSON.stringify({
          userId,
          hours: inputValue ? parsedHours : null
        })
      });
      setProject((data?.project ?? null) as Project | null);
      setUserHours(((data?.userHours ?? []) as ProjectUserHoursEntry[]));
      setStatus("Team hours saved");
    } finally {
      setSavingArchivedHoursUserId(null);
    }
  }

  async function restoreArchivedProject() {
    if (!token || !projectId) return;

    setIsRestoringProject(true);
    try {
      await authedFetch(token, `/projects/${projectId}/restore`, { method: "POST" });
      await load(token, projectId);
      setStatus("Project restored");
    } finally {
      setIsRestoringProject(false);
    }
  }

  function openEditProjectDialog() {
    setProjectForm(createProjectDialogValues(project?.client_id ?? "", project));
    editProjectDialogRef.current?.showModal();
  }

  function openCreateDiscussionDialog() {
    setTitle("");
    setBodyMarkdown("");
    setCreateDiscussionEditorKey((current) => current + 1);
    createDiscussionDialogRef.current?.showModal();
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
      const upload = init && typeof init === "object" && "upload" in init ? init.upload : null;
      const sessionId =
        upload && typeof upload === "object" && "sessionId" in upload ? String(upload.sessionId ?? "") : "";
      const targetPath =
        upload && typeof upload === "object" && "targetPath" in upload ? String(upload.targetPath ?? "") : "";
      if (!sessionId || !targetPath) {
        throw new Error("Upload initialization failed");
      }

      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("sessionId", sessionId);
      formData.append("targetPath", targetPath);

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
    const downloadUrl = typeof data?.url === "string" ? data.url : "";
    if (downloadUrl) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function openProjectFolder() {
    if (!token || !projectId) return;
    const data = await authedFetch(token, `/projects/${projectId}/folder-link`);
    const folderUrl = typeof data?.url === "string" ? data.url : "";
    if (folderUrl) {
      window.open(folderUrl, "_blank", "noopener,noreferrer");
    }
  }

  function handleFileInputSelection(list: FileList | null) {
    setSelectedFile(list?.[0] ?? null);
  }

  async function authedMultipartFetch(accessToken: string, path: string, body: FormData) {
    const { accessToken: nextToken, data } = await authedFormDataFetch({
      accessToken,
      body,
      init: { method: "POST" },
      onToken: setToken,
      path
    });
    if (nextToken !== token) {
      setToken(nextToken);
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

  const projectTitle = project?.display_name ?? project?.name ?? "Project";
  const requestor = project?.requestor?.trim() ?? "";
  const projectDescription = project?.description?.trim() ?? "";
  const totalArchivedHours = userHours.reduce((sum, entry) => sum + parseHoursNumber(entry.hours), 0);

  return (
    <main className="page">
      <header className="header">
        <div className={`projectHeaderCopy projectStatusTone tone-${normalizeProjectColumn(project)}`}>
          <h1 className="projectHeaderTitle">
            <span>{projectTitle}</span>
            {requestor ? (
              <span className="projectHeaderRequestor">
                <span aria-hidden="true" className="projectHeaderRequestorSeparator">
                  {" "}
                  -
                </span>
                {requestor}
              </span>
            ) : null}
          </h1>
          {project?.deadline ? <p className="headerSubtitle">Deadline: {formatDeadline(project.deadline)}</p> : null}
          {projectDescription ? <p className="headerSubtitle">{projectDescription}</p> : null}
          <ProjectTagList tags={project?.tags} className="projectHeaderTags" />
          <div className="projectHoursRow">
            {project?.archived ? (
              <div className="projectArchivedHours">
                <p className="projectArchivedHoursLabel">Team Hours</p>
                {userHours.length > 0 ? (
                  <div className="projectArchivedHoursBody">
                    <ul className="projectArchivedHoursList">
                      {userHours.map((entry) => (
                        <li key={entry.userId} className="projectArchivedHoursRow">
                          <span className="projectArchivedHoursUser">
                            {entry.avatarUrl ? (
                              <img src={getAvatarProxyUrl(entry.avatarUrl)} alt="" className="projectHoursAvatar" />
                            ) : (
                              <span className="projectHoursAvatar projectHoursAvatarFallback">{getHoursEntryInitials(entry)}</span>
                            )}
                            <span className="projectArchivedHoursName">
                              {getHoursEntryLabel(entry)}
                            </span>
                          </span>
                          <div className="projectArchivedHoursEditor">
                            <input
                              type="number"
                              min="0"
                              step="0.25"
                              inputMode="decimal"
                              className="projectArchivedHoursInput"
                              value={archivedHoursInputs[entry.userId] ?? ""}
                              onChange={(event) =>
                                setArchivedHoursInputs((current) => ({
                                  ...current,
                                  [entry.userId]: event.target.value
                                }))
                              }
                              placeholder="0"
                              aria-label={`${getHoursEntryLabel(entry)} hours`}
                            />
                            <button
                              type="button"
                              className="secondary projectArchivedHoursSave"
                              disabled={
                                savingArchivedHoursUserId === entry.userId ||
                                (archivedHoursInputs[entry.userId] ?? "") === formatHoursInput(entry.hours)
                              }
                              onClick={() => saveArchivedHours(entry.userId).catch((error) => setStatus(error.message))}
                            >
                              {savingArchivedHoursUserId === entry.userId ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="projectArchivedHoursTotal">
                      <span>Total</span>
                      <strong>{formatHoursValue(totalArchivedHours)}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="projectArchivedHoursEmpty">No hours logged for this archived project.</p>
                )}
              </div>
            ) : (
              <form
                className="projectHoursForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMyHours().catch((error) => setStatus(error.message));
                }}
              >
                <label className="projectHoursField">
                  <span>My Hours</span>
                  <span className="projectHoursFieldInput">
                    {viewerProfile?.avatar_url ? (
                      <img src={getAvatarProxyUrl(viewerProfile.avatar_url)} alt="Your avatar" className="projectHoursAvatar" />
                    ) : (
                      <span className="projectHoursAvatar projectHoursAvatarFallback">{getViewerInitials(viewerProfile)}</span>
                    )}
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      inputMode="decimal"
                      value={myHoursInput}
                      onChange={(event) => setMyHoursInput(event.target.value)}
                      placeholder="0"
                    />
                  </span>
                </label>
                <button
                  type="submit"
                  className="secondary"
                  disabled={isSavingMyHours || myHoursInput === formatHoursInput(project?.my_hours)}
                >
                  {isSavingMyHours ? "Saving..." : "Save"}
                </button>
              </form>
            )}
          </div>
        </div>
        <div className="row">
          <Link href="/" className="linkButton">
            All Projects
          </Link>
          {project?.archived ? (
            <button
              type="button"
              className="secondary"
              onClick={() => restoreArchivedProject().catch((error) => setStatus(error.message))}
              disabled={isRestoringProject}
            >
              {isRestoringProject ? "Restoring..." : "Restore Project"}
            </button>
          ) : null}
          <button type="button" className="iconButton" aria-label="Edit project" onClick={openEditProjectDialog}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.66 7.66 0 0 0 .05-.94 7.66 7.66 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94L2.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
        </div>
      </header>

      <section className="stackSection">
        <div className="sectionHeader">
          <h2>Discussions</h2>
          <button
            className="iconButton"
            aria-label="Create discussion"
            onClick={openCreateDiscussionDialog}
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
            <button
              type="button"
              className="filesFolderLink"
              onClick={() => openProjectFolder().catch((error) => setStatus(error.message))}
            >
              Open Dropbox folder
            </button>
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

      <dialog ref={createDiscussionDialogRef} className="dialog dialogCreateDiscussion">
        <form method="dialog" className="dialogForm">
          <h3>Create Discussion</h3>
          <div className="form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discussion title" />
            <MarkdownEditor
              key={`create-discussion-${createDiscussionEditorKey}`}
              markdown={bodyMarkdown}
              onChange={setBodyMarkdown}
              placeholder="Write the discussion body in markdown"
              overlayContainer={createDiscussionDialogRef.current}
            />
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => createDiscussion().catch((error) => setStatus(error.message))}
              disabled={!title || !bodyMarkdown}
            >
              Create
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setTitle("");
                setBodyMarkdown("");
                setCreateDiscussionEditorKey((current) => current + 1);
                createDiscussionDialogRef.current?.close();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={editProjectDialogRef} className="dialog">
        <ProjectDialogForm
          title="Edit Project"
          submitLabel="Save Changes"
          values={projectForm}
          clients={clients}
          submitting={isSavingProject}
          clientDisabled
          onChange={setProjectForm}
          onSubmit={() => saveProject().catch((error) => setStatus(error.message))}
          onCancel={() => editProjectDialogRef.current?.close()}
        />
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

function formatDeadline(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatHoursInput(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? String(numericValue) : "";
}

function parseHoursNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatHoursValue(value: number | string | null | undefined) {
  const numericValue = parseHoursNumber(value);
  return `${numericValue.toFixed(numericValue % 1 === 0 ? 0 : 2)}h`;
}

function parseProjectTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function createProjectDialogValues(clientId = "", project?: Project | null): ProjectDialogValues {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    deadline: project?.deadline ?? "",
    requestor: project?.requestor ?? "",
    tags: (project?.tags ?? []).join(", "),
    clientId
  };
}

function getViewerInitials(profile: ViewerProfile | null) {
  const firstName = (profile?.first_name ?? "").trim();
  const lastName = (profile?.last_name ?? "").trim();
  if (firstName || lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "U";
  }

  const emailLocalPart = (profile?.email ?? "user").split("@")[0];
  return emailLocalPart.slice(0, 2).toUpperCase() || "U";
}

function getHoursEntryLabel(entry: ProjectUserHoursEntry) {
  const fullName = `${entry.firstName ?? ""} ${entry.lastName ?? ""}`.trim();
  return fullName || entry.email;
}

function getHoursEntryInitials(entry: ProjectUserHoursEntry) {
  const firstName = (entry.firstName ?? "").trim();
  const lastName = (entry.lastName ?? "").trim();
  if (firstName || lastName) {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "U";
  }

  return entry.email.split("@")[0].slice(0, 2).toUpperCase() || "U";
}

async function loadProjectData(accessToken: string, projectId: string) {
  const [projectRes, threadsRes, filesRes, clientsRes, profileRes] = await Promise.all([
    authedJsonFetch({ accessToken, path: `/projects/${projectId}` }),
    authedJsonFetch({ accessToken, path: `/projects/${projectId}/threads` }),
    authedJsonFetch({ accessToken, path: `/projects/${projectId}/files` }),
    authedJsonFetch({ accessToken, path: "/clients" }),
    authedJsonFetch({ accessToken, path: "/profile" })
  ]);

  return {
    accessToken: projectRes.accessToken,
    project: (projectRes.data?.project ?? null) as Project | null,
    userHours: (projectRes.data?.userHours ?? []) as ProjectUserHoursEntry[],
    threads: (threadsRes.data?.threads ?? []) as Thread[],
    files: (filesRes.data?.files ?? []) as ProjectFile[],
    clients: (clientsRes.data?.clients ?? []) as ClientRecord[],
    viewerProfile: (profileRes.data?.profile ?? null) as ViewerProfile | null
  };
}

async function loadProjectBootstrap(projectId: string): Promise<ProjectPageBootstrap> {
  if (!projectId) {
    return {
      token: null,
      status: "Loading project…",
      project: null,
      userHours: [],
      clients: [],
      viewerProfile: null,
      threads: [],
      files: []
    };
  }

  try {
    const session = await fetchAuthSession();
    const accessToken = session.accessToken;

    if (!accessToken) {
      return {
        token: null,
        status: session.status || "Sign in first",
        project: null,
        userHours: [],
        clients: [],
        viewerProfile: null,
        threads: [],
        files: []
      };
    }

    const nextState = await loadProjectData(accessToken, projectId);
    return {
      token: nextState.accessToken,
      status: session.status,
      ...nextState
    };
  } catch (error) {
    return {
      token: null,
      status: error instanceof Error ? error.message : "Load failed",
      project: null,
      userHours: [],
      clients: [],
      viewerProfile: null,
      threads: [],
      files: []
    };
  }
}
