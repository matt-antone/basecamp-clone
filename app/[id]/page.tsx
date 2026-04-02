"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { CreateDiscussionDialog } from "@/components/discussions/create-discussion-dialog";
import { InlineLoadingState, PageLoadingState } from "@/components/loading-shells";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectDialogForm, type ProjectDialogValues } from "@/components/project-dialog-form";
import { ProjectTagList } from "@/components/project-tag-list";
import { ProjectFilesPanel } from "@/components/projects/project-files-panel";
import { getAvatarProxyUrl } from "@/lib/avatar";
import { authedFormDataFetch, authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import { createClientResource } from "@/lib/client-resource";
import { calculateProjectExpensesTotalUsd, formatUsdInput, formatUsdMoney } from "@/lib/project-financials";
import { createProjectDialogValues, normalizeProjectColumn, parseProjectTags } from "@/lib/project-utils";
import type { ClientRecord } from "@/lib/repositories";
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
  /** PM-facing note (max 256); optional until migration applied. */
  pm_note?: string | null;
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

type ProjectExpenseLine = {
  id: string;
  projectId: string;
  label: string;
  amount: number | string;
  sortOrder: number;
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
  thumbnail_url?: string | null;
  created_at: string;
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
  expenseLines: ProjectExpenseLine[];
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
  const [, setStatus] = useState(initial.status);

  const [project, setProject] = useState<Project | null>(initial.project);
  const [userHours, setUserHours] = useState<ProjectUserHoursEntry[]>(initial.userHours);
  const [expenseLines, setExpenseLines] = useState<ProjectExpenseLine[]>(initial.expenseLines);
  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(initial.viewerProfile);
  const [threads, setThreads] = useState<Thread[]>(initial.threads);
  const [files, setFiles] = useState<ProjectFile[]>(initial.files);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingMyHours, setIsSavingMyHours] = useState(false);
  const [isRestoringProject, setIsRestoringProject] = useState(false);
  const [savingArchivedHoursUserId, setSavingArchivedHoursUserId] = useState<string | null>(null);
  const [savingExpenseLineId, setSavingExpenseLineId] = useState<string | null>(null);
  const [deletingExpenseLineId, setDeletingExpenseLineId] = useState<string | null>(null);
  const [isCreatingExpenseLine, setIsCreatingExpenseLine] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectDialogValues>(createProjectDialogValues());
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [myHoursInput, setMyHoursInput] = useState("");
  const [archivedHoursInputs, setArchivedHoursInputs] = useState<Record<string, string>>({});
  const [expenseLineDrafts, setExpenseLineDrafts] = useState<Record<string, { label: string; amount: string }>>({});
  const [newExpenseLine, setNewExpenseLine] = useState({ label: "", amount: "" });
  const [createDiscussionEditorKey, setCreateDiscussionEditorKey] = useState(0);
  const editProjectDialogRef = useRef<HTMLDialogElement | null>(null);
  const createDiscussionDialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setExpenseLines(nextState.expenseLines);
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
    setExpenseLineDrafts(
      Object.fromEntries(
        expenseLines.map((entry) => [
          entry.id,
          {
            label: entry.label,
            amount: formatUsdInput(entry.amount)
          }
        ])
      )
    );
  }, [expenseLines]);

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
          requestor: projectForm.requestor.trim() || null,
          pm_note: projectForm.pm_note.trim() || null
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
      setUserHours(((data?.userHours ?? []) as ProjectUserHoursEntry[]));
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

  async function createExpenseLine() {
    if (!token || !projectId) return;

    const label = newExpenseLine.label.trim();
    const amountValue = newExpenseLine.amount.trim();
    const amount = amountValue ? Number(amountValue) : Number.NaN;
    if (!label) {
      throw new Error("Expense label is required");
    }
    if (!amountValue || !Number.isFinite(amount) || amount < 0) {
      throw new Error("Expense amount must be a non-negative number");
    }

    setIsCreatingExpenseLine(true);
    try {
      const data = await authedFetch(token, `/projects/${projectId}/expense-lines`, {
        method: "POST",
        body: JSON.stringify({
          label,
          amount
        })
      });
      const created = (data?.expenseLine ?? null) as ProjectExpenseLine | null;
      if (created) {
        setExpenseLines((current) => [...current, created]);
        setNewExpenseLine({ label: "", amount: "" });
      }
      setStatus("Expense line added");
    } finally {
      setIsCreatingExpenseLine(false);
    }
  }

  async function saveExpenseLine(lineId: string) {
    if (!token || !projectId) return;

    const draft = expenseLineDrafts[lineId];
    const label = draft?.label.trim() ?? "";
    const amountValue = draft?.amount.trim() ?? "";
    const amount = amountValue ? Number(amountValue) : Number.NaN;
    const existing = expenseLines.find((entry) => entry.id === lineId);
    if (!existing) {
      return;
    }
    if (!label) {
      throw new Error("Expense label is required");
    }
    if (!amountValue || !Number.isFinite(amount) || amount < 0) {
      throw new Error("Expense amount must be a non-negative number");
    }

    setSavingExpenseLineId(lineId);
    try {
      const data = await authedFetch(token, `/projects/${projectId}/expense-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({
          label,
          amount,
          sortOrder: existing.sortOrder
        })
      });
      const updated = (data?.expenseLine ?? null) as ProjectExpenseLine | null;
      if (updated) {
        setExpenseLines((current) => current.map((entry) => (entry.id === lineId ? updated : entry)));
      }
      setStatus("Expense line saved");
    } finally {
      setSavingExpenseLineId(null);
    }
  }

  async function deleteExpenseLine(lineId: string) {
    if (!token || !projectId) return;

    setDeletingExpenseLineId(lineId);
    try {
      await authedFetch(token, `/projects/${projectId}/expense-lines/${lineId}`, {
        method: "DELETE"
      });
      setExpenseLines((current) => current.filter((entry) => entry.id !== lineId));
      setExpenseLineDrafts((current) => {
        const next = { ...current };
        delete next[lineId];
        return next;
      });
      setStatus("Expense line deleted");
    } finally {
      setDeletingExpenseLineId(null);
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

  const projectTitle = project?.display_name ?? project?.name ?? "Project";
  const requestor = project?.requestor?.trim() ?? "";
  const projectDescription = project?.description?.trim() ?? "";
  const totalArchivedHours = userHours.reduce((sum, entry) => sum + parseHoursNumber(entry.hours), 0);
  const expenseSubtotalUsd = calculateProjectExpensesTotalUsd(expenseLines);

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
                            <OneShotButton
                              type="button"
                              className="secondary projectArchivedHoursSave"
                              disabled={
                                savingArchivedHoursUserId === entry.userId ||
                                (archivedHoursInputs[entry.userId] ?? "") === formatHoursInput(entry.hours)
                              }
                              onClick={() => saveArchivedHours(entry.userId).catch((error) => setStatus(error.message))}
                            >
                              {savingArchivedHoursUserId === entry.userId ? "Saving..." : "Save"}
                            </OneShotButton>
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
                <OneShotButton
                  type="submit"
                  className="secondary"
                  disabled={isSavingMyHours || myHoursInput === formatHoursInput(project?.my_hours)}
                >
                  {isSavingMyHours ? "Saving..." : "Save"}
                </OneShotButton>
              </form>
            )}
          </div>
        </div>
        <div className="row">
          <Link href="/" className="linkButton">
            All Projects
          </Link>
          {project?.archived ? (
            <OneShotButton
              type="button"
              className="secondary"
              onClick={() => restoreArchivedProject().catch((error) => setStatus(error.message))}
              disabled={isRestoringProject}
            >
              {isRestoringProject ? "Restoring..." : "Restore Project"}
            </OneShotButton>
          ) : null}
          <OneShotButton type="button" className="iconButton" aria-label="Edit project" onClick={openEditProjectDialog}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94a7.66 7.66 0 0 0 .05-.94 7.66 7.66 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94L2.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </OneShotButton>
        </div>
      </header>

      <section className="stackSection">
        <div className="sectionHeader">
          <h2>Discussions</h2>
          <OneShotButton
            className="iconButton"
            aria-label="Create discussion"
            onClick={openCreateDiscussionDialog}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
            </svg>
          </OneShotButton>
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

      <ProjectFilesPanel
        projectId={projectId}
        token={token}
        onToken={setToken}
        files={files}
        selectedFile={selectedFile}
        isUploading={isUploading}
        isFileDragActive={isFileDragActive}
        fileInputRef={fileInputRef}
        onFileInputSelection={handleFileInputSelection}
        onSetFileDragActive={setIsFileDragActive}
        onOpenProjectFolder={() => openProjectFolder().catch((error) => setStatus(error.message))}
        onUploadSelectedFile={() => uploadSelectedFile().catch((error) => setStatus(error.message))}
        onClearSelectedFile={() => {
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }}
        onDownloadFile={(fileId) => downloadFile(fileId).catch((error) => setStatus(error.message))}
        getFileBadgeLabel={getFileBadgeLabel}
      />

      <section className="stackSection">
        <div className="sectionHeader">
          <h2>Financial Rollup</h2>
        </div>

        <div className="projectFinancialGrid">
          <section className="projectFinancialCard">
            <div className="projectFinancialCardHeader">
              <h3>Hours</h3>
              <span>{formatHoursValue(totalArchivedHours)}</span>
            </div>
            {userHours.length > 0 ? (
              <div className="projectFinancialTable" role="table" aria-label="Hours rollup">
                {userHours.map((entry) => (
                  <div key={entry.userId} className="projectFinancialRow projectFinancialRowHoursOnly" role="row">
                    <div className="projectFinancialPerson" role="cell">
                      {entry.avatarUrl ? (
                        <img src={getAvatarProxyUrl(entry.avatarUrl)} alt="" className="projectHoursAvatar" />
                      ) : (
                        <span className="projectHoursAvatar projectHoursAvatarFallback">{getHoursEntryInitials(entry)}</span>
                      )}
                      <span>{getHoursEntryLabel(entry)}</span>
                    </div>
                    <span role="cell">{formatHoursValue(entry.hours)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="projectFinancialEmpty">No hours logged yet.</p>
            )}
          </section>

          <section className="projectFinancialCard">
            <div className="projectFinancialCardHeader">
              <h3>Expense Lines</h3>
              <span>{expenseLines.length} items</span>
            </div>
            <div className="projectExpenseComposer">
              <input
                value={newExpenseLine.label}
                onChange={(event) => setNewExpenseLine((current) => ({ ...current, label: event.target.value }))}
                placeholder="Expense label"
                aria-label="New expense label"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={newExpenseLine.amount}
                onChange={(event) => setNewExpenseLine((current) => ({ ...current, amount: event.target.value }))}
                placeholder="0.00"
                aria-label="New expense amount"
              />
              <OneShotButton
                type="button"
                className="secondary"
                disabled={isCreatingExpenseLine}
                onClick={() => createExpenseLine().catch((error) => setStatus(error.message))}
              >
                {isCreatingExpenseLine ? "Adding..." : "Add expense"}
              </OneShotButton>
            </div>
            {expenseLines.length > 0 ? (
              <div className="projectExpenseList">
                {expenseLines.map((line) => {
                  const draft = expenseLineDrafts[line.id] ?? {
                    label: line.label,
                    amount: formatUsdInput(line.amount)
                  };
                  const isDirty = draft.label !== line.label || draft.amount !== formatUsdInput(line.amount);

                  return (
                    <div key={line.id} className="projectExpenseRow">
                      <input
                        value={draft.label}
                        onChange={(event) =>
                          setExpenseLineDrafts((current) => ({
                            ...current,
                            [line.id]: {
                              ...draft,
                              label: event.target.value
                            }
                          }))
                        }
                        aria-label={`${line.label} label`}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={draft.amount}
                        onChange={(event) =>
                          setExpenseLineDrafts((current) => ({
                            ...current,
                            [line.id]: {
                              ...draft,
                              amount: event.target.value
                            }
                          }))
                        }
                        aria-label={`${line.label} amount`}
                      />
                      <OneShotButton
                        type="button"
                        className="secondary"
                        disabled={savingExpenseLineId === line.id || !isDirty}
                        onClick={() => saveExpenseLine(line.id).catch((error) => setStatus(error.message))}
                      >
                        {savingExpenseLineId === line.id ? "Saving..." : "Save"}
                      </OneShotButton>
                      <OneShotButton
                        type="button"
                        className="secondary"
                        disabled={deletingExpenseLineId === line.id}
                        onClick={() => deleteExpenseLine(line.id).catch((error) => setStatus(error.message))}
                      >
                        {deletingExpenseLineId === line.id ? "Deleting..." : "Delete"}
                      </OneShotButton>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="projectFinancialEmpty">No expense lines yet.</p>
            )}
            <div className="projectFinancialSummary">
              <span>Expense subtotal</span>
              <strong>{formatUsdMoney(expenseSubtotalUsd)}</strong>
            </div>
          </section>
        </div>

        <div className="projectFinancialGrandTotal">
          <span>Total (expenses)</span>
          <strong>{formatUsdMoney(expenseSubtotalUsd)}</strong>
        </div>
      </section>

      <CreateDiscussionDialog
        dialogRef={createDiscussionDialogRef}
        title={title}
        bodyMarkdown={bodyMarkdown}
        onTitleChange={setTitle}
        onCreate={() => createDiscussion().catch((error) => setStatus(error.message))}
        onCancel={() => {
          setTitle("");
          setBodyMarkdown("");
          setCreateDiscussionEditorKey((current) => current + 1);
          createDiscussionDialogRef.current?.close();
        }}
        editor={(
          <MarkdownEditor
            key={`create-discussion-${createDiscussionEditorKey}`}
            markdown={bodyMarkdown}
            onChange={setBodyMarkdown}
            placeholder="Write the discussion body in markdown"
            overlayContainer={createDiscussionDialogRef.current}
          />
        )}
      />

      <dialog ref={editProjectDialogRef} className="dialog">
        <ProjectDialogForm
          title="Edit Project"
          submitLabel="Save Changes"
          values={projectForm}
          clients={clients}
          submitting={isSavingProject}
          clientDisabled
          showPmNote
          onChange={setProjectForm}
          onSubmit={() => saveProject().catch((error) => setStatus(error.message))}
          onCancel={() => editProjectDialogRef.current?.close()}
        />
      </dialog>
    </main >
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
  const [projectRes, threadsRes, filesRes, clientsRes, profileRes, expenseLinesRes] = await Promise.all([
    authedJsonFetch({ accessToken, path: `/projects/${projectId}` }),
    authedJsonFetch({ accessToken, path: `/projects/${projectId}/threads` }),
    authedJsonFetch({ accessToken, path: `/projects/${projectId}/files` }),
    authedJsonFetch({ accessToken, path: "/clients" }),
    authedJsonFetch({ accessToken, path: "/profile" }),
    authedJsonFetch({ accessToken, path: `/projects/${projectId}/expense-lines` })
  ]);

  return {
    accessToken: projectRes.accessToken,
    project: (projectRes.data?.project ?? null) as Project | null,
    userHours: (projectRes.data?.userHours ?? []) as ProjectUserHoursEntry[],
    expenseLines: (expenseLinesRes.data?.expenseLines ?? []) as ProjectExpenseLine[],
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
      expenseLines: [],
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
        expenseLines: [],
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
      expenseLines: [],
      clients: [],
      viewerProfile: null,
      threads: [],
      files: []
    };
  }
}
