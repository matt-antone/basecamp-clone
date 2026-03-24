"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type SessionUser = { id: string; email?: string };
type ClientRecord = { id: string; name: string; code: string };
type Project = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  archived: boolean;
  status?: string | null;
  client_id: string | null;
  client_name?: string | null;
  client_code?: string | null;
};

type ProjectColumn = "new" | "in_progress" | "blocked" | "complete";
type ProjectsViewTab = "list" | "board" | "archived";

export default function ProjectsPage() {
  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [domainAllowed, setDomainAllowed] = useState(false);

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<ProjectsViewTab>("list");

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectClientId, setNewProjectClientId] = useState("");
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ProjectColumn | null>(null);

  const createDialogRef = useRef<HTMLDialogElement | null>(null);

  async function authedFetch(path: string, options: RequestInit = {}) {
    if (!accessToken) {
      throw new Error("Missing access token");
    }

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
      throw new Error(data.error ?? `Request failed: ${response.status}`);
    }
    return data;
  }

  async function refreshClients() {
    const data = await authedFetch("/clients");
    const loaded = data.clients ?? [];
    setClients(loaded);
    if (!newProjectClientId && loaded[0]?.id) {
      setNewProjectClientId(loaded[0].id);
    }
  }

  async function refreshProjects() {
    const data = await authedFetch("/projects?includeArchived=true");
    setProjects(data.projects ?? []);
  }

  useEffect(() => {
    try {
      setSupabase(getSupabaseBrowserClient());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supabase init error");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
      setAccessToken(data.session?.access_token ?? null);
      if (!data.session?.user?.email) {
        setStatus("Please sign in");
        return;
      }

      const response = await fetch("/auth/google/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google", email: data.session.user.email })
      });

      if (!response.ok) {
        setStatus("Blocked: non-workspace account");
        await supabase.auth.signOut();
        return;
      }

      setDomainAllowed(true);
      setStatus(`Signed in as ${data.session.user.email}`);
    };

    init().catch((error) => setStatus(error instanceof Error ? error.message : "Init failed"));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setAccessToken(session?.access_token ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!domainAllowed || !accessToken) return;
    refreshClients().catch((error) => setStatus(error instanceof Error ? error.message : "Failed loading clients"));
    refreshProjects().catch((error) => setStatus(error instanceof Error ? error.message : "Failed loading projects"));
  }, [domainAllowed, accessToken]);

  async function signIn() {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setDomainAllowed(false);
    setProjects([]);
    setClients([]);
    setStatus("Signed out");
  }

  async function createProject() {
    await authedFetch("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: newProjectName,
        description: newProjectDescription,
        clientId: newProjectClientId
      })
    });
    setNewProjectName("");
    setNewProjectDescription("");
    createDialogRef.current?.close();
    await refreshProjects();
  }

  async function toggleArchive(project: Project) {
    await authedFetch(`/projects/${project.id}/${project.archived ? "restore" : "archive"}`, { method: "POST" });
    await refreshProjects();
  }

  function normalizeProjectColumn(project: Project): ProjectColumn {
    const value = (project.status ?? "new").toLowerCase();
    if (value === "in_progress" || value === "in progress") return "in_progress";
    if (value === "blocked") return "blocked";
    if (value === "complete" || value === "completed") return "complete";
    return "new";
  }

  const columns: { key: ProjectColumn; title: string; subtitle: string }[] = [
    { key: "new", title: "New", subtitle: "Ready to start" },
    { key: "in_progress", title: "In Progress", subtitle: "Active work" },
    { key: "blocked", title: "Blocked", subtitle: "Needs attention" },
    { key: "complete", title: "Complete", subtitle: "Wrapped up" }
  ];

  const activeProjects = projects.filter((project) => !project.archived);
  const archivedProjects = projects.filter((project) => project.archived);

  function getProjectClientLabel(project: Project) {
    return project.client_name?.trim() || project.client_code?.trim() || "No client";
  }

  function groupProjectsByClient(items: Project[]) {
    const grouped = new Map<string, { label: string; projects: Project[] }>();
    items.forEach((project) => {
      const key = project.client_id ?? `uncategorized-${getProjectClientLabel(project).toLowerCase()}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          label: getProjectClientLabel(project),
          projects: []
        });
      }
      grouped.get(key)?.projects.push(project);
    });

    return Array.from(grouped.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((group) => ({
        ...group,
        projects: group.projects.sort((a, b) =>
          (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)
        )
      }));
  }

  function renderProjectList(items: Project[], emptyState: string) {
    const groups = groupProjectsByClient(items);
    if (groups.length === 0) {
      return <p className="emptyProjectsText">{emptyState}</p>;
    }

    return (
      <div className="projectClientGroups">
        {groups.map((group) => (
          <section key={group.label} className="projectClientGroup">
            <header className="projectClientGroupHeader">
              <h3>{group.label}</h3>
              <span>{group.projects.length}</span>
            </header>
            <ul className="projectList">
              {group.projects.map((project) => (
                <li key={project.id} className="projectListItem">
                  <div className="projectMain">
                    <Link href={`/${project.id}`} className="projectLink projectTitle">
                      {renderProjectTitle(project.display_name ?? project.name)}
                    </Link>
                    <p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
                  </div>
                  <div className="row projectCardActions">
                    <Link href={`/${project.id}`} className="iconButton secondaryIconButton" title="Read project" aria-label="Read project">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 5C6.5 5 2.1 8.3 1 12c1.1 3.7 5.5 7 11 7s9.9-3.3 11-7c-1.1-3.7-5.5-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.2A1.8 1.8 0 1 0 12 10a1.8 1.8 0 0 0 0 3.6Z"
                        />
                      </svg>
                    </Link>
                    <button
                      className="iconButton secondaryIconButton"
                      title={project.archived ? "Restore project" : "Archive project"}
                      aria-label={project.archived ? "Restore project" : "Archive project"}
                      onClick={() => toggleArchive(project).catch((error) => setStatus(error.message))}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M20 7v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7h16Zm-6 3h-4a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2ZM21 3a1 1 0 0 1 1 1v2H2V4a1 1 0 0 1 1-1h18Z"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  function renderProjectTitle(title: string) {
    const codeRegex = /\b[A-Z]{2,}-\d{4}\b/g;
    const parts: ReactNode[] = [];
    let lastIndex = 0;

    for (const match of title.matchAll(codeRegex)) {
      const start = match.index ?? 0;
      const code = match[0];
      if (start > lastIndex) {
        parts.push(title.slice(lastIndex, start));
      }
      parts.push(
        <strong className="projectCodeStrong" key={`${code}-${start}`}>
          {code}
        </strong>
      );
      lastIndex = start + code.length;
    }

    if (lastIndex < title.length) {
      parts.push(title.slice(lastIndex));
    }

    return parts.length ? parts : title;
  }

  async function moveProject(projectId: string, targetColumn: ProjectColumn) {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const currentColumn = normalizeProjectColumn(source);
    if (currentColumn === targetColumn) return;

    const previousProjects = projects;
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              status: targetColumn
            }
          : project
      )
    );

    try {
      await authedFetch(`/projects/${projectId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: targetColumn })
      });
    } catch (error) {
      setProjects(previousProjects);
      throw error;
    }
  }

  return (
    <main className="page">
      <header className="header">
        <div className="row headingRow">
          <h1>Projects</h1>
          {domainAllowed && (
            <button className="iconButton" aria-label="Create project" onClick={() => createDialogRef.current?.showModal()}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
              </svg>
            </button>
          )}
        </div>
        <div className="row">
          {user && (
            <Link href="/settings" className="iconButton" aria-label="Settings">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M19.14 12.94a7.66 7.66 0 0 0 .05-.94 7.66 7.66 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94L2.82 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                />
              </svg>
            </Link>
          )}
          {!user && <button onClick={signIn}>Sign in with Google</button>}
          {user && <button onClick={signOut}>Sign out</button>}
        </div>
      </header>

      {domainAllowed && (
        <div className="tabsRow projectTabsRow" role="tablist" aria-label="Projects views">
          <button
            className={`tabButton ${activeTab === "list" ? "activeTab" : ""}`}
            role="tab"
            aria-selected={activeTab === "list"}
            onClick={() => setActiveTab("list")}
          >
            List
          </button>
          <button
            className={`tabButton ${activeTab === "board" ? "activeTab" : ""}`}
            role="tab"
            aria-selected={activeTab === "board"}
            onClick={() => setActiveTab("board")}
          >
            Project Board
          </button>
          <button
            className={`tabButton ${activeTab === "archived" ? "activeTab" : ""}`}
            role="tab"
            aria-selected={activeTab === "archived"}
            onClick={() => setActiveTab("archived")}
          >
            Archived Projects
          </button>
        </div>
      )}

      <p className="status">{status}</p>

      {domainAllowed && (
        <div className="layoutSingle">
          {activeTab === "list" && renderProjectList(activeProjects, "No active projects yet.")}
          {activeTab === "board" && (
            <div className="kanbanGrid">
              {columns.map((column) => {
                const columnProjects = activeProjects.filter((project) => normalizeProjectColumn(project) === column.key);
                return (
                  <section
                    key={column.key}
                    className={`kanbanColumn ${dragOverColumn === column.key ? "kanbanColumnDropTarget" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverColumn(column.key);
                    }}
                    onDragLeave={() => {
                      setDragOverColumn((current) => (current === column.key ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedProjectId = event.dataTransfer.getData("text/plain");
                      setDragOverColumn(null);
                      setDraggingProjectId(null);
                      if (!draggedProjectId) return;
                      moveProject(draggedProjectId, column.key).catch((error) => {
                        setStatus(error instanceof Error ? error.message : "Failed to move project");
                      });
                    }}
                  >
                    <header className="kanbanColumnHeader">
                      <div className="kanbanColumnTitleBlock">
                        <h3>{column.title}</h3>
                        <p className="kanbanColumnSubtitle">{column.subtitle}</p>
                      </div>
                      <span>{columnProjects.length}</span>
                    </header>
                    <ul className="kanbanList">
                      {columnProjects.map((project) => (
                        <li
                          key={project.id}
                          className={`projectCard ${draggingProjectId === project.id ? "projectCardDragging" : ""}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", project.id);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingProjectId(project.id);
                          }}
                          onDragEnd={() => {
                            setDraggingProjectId(null);
                            setDragOverColumn(null);
                          }}
                        >
                          <div className="projectMain projectCardMain">
                            <Link href={`/${project.id}`} className="projectLink projectTitle">
                              {renderProjectTitle(project.display_name ?? project.name)}
                            </Link>
                            <p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
                            <div className="projectMeta">
                              <span className="projectClientPill">
                                {project.client_code?.trim() || project.client_name?.trim() || "No client"}
                              </span>
                            </div>
                          </div>
                          {(column.key === "complete" || column.key === "blocked") && (
                            <div className="row projectCardActions">
                              <Link
                                href={`/${project.id}`}
                                className="iconButton secondaryIconButton"
                                title="Read project"
                                aria-label="Read project"
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                                  <path
                                    fill="currentColor"
                                    d="M12 5C6.5 5 2.1 8.3 1 12c1.1 3.7 5.5 7 11 7s9.9-3.3 11-7c-1.1-3.7-5.5-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.2A1.8 1.8 0 1 0 12 10a1.8 1.8 0 0 0 0 3.6Z"
                                  />
                                </svg>
                              </Link>
                              <button
                                className="iconButton secondaryIconButton"
                                title="Archive project"
                                aria-label="Archive project"
                                onClick={() => toggleArchive(project).catch((error) => setStatus(error.message))}
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                                  <path
                                    fill="currentColor"
                                    d="M20 7v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7h16Zm-6 3h-4a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2ZM21 3a1 1 0 0 1 1 1v2H2V4a1 1 0 0 1 1-1h18Z"
                                  />
                                </svg>
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {activeTab === "archived" && renderProjectList(archivedProjects, "No archived projects.")}
        </div>
      )}

      <dialog ref={createDialogRef} className="dialog">
        <form method="dialog" className="dialogForm">
          <h3>Create Project</h3>
          <div className="form">
            <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name" />
            <input
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              placeholder="Description"
            />
            <select value={newProjectClientId} onChange={(e) => setNewProjectClientId(e.target.value)}>
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} - {client.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => createProject().catch((error) => setStatus(error.message))}
              disabled={!newProjectName.trim() || !newProjectClientId}
            >
              Create
            </button>
            <button type="button" className="secondary" onClick={() => createDialogRef.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
