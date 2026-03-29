"use client";

import Link from "next/link";
import { PageLoadingState } from "@/components/loading-shells";
import { ProjectDialogForm, type ProjectDialogValues } from "@/components/project-dialog-form";
import { ProjectTagList } from "@/components/project-tag-list";
import { createClientResource } from "@/lib/client-resource";
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { FeaturedFeedPost } from "@/lib/featured-feed";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";

type ClientRecord = { id: string; name: string; code: string };
type Project = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  deadline?: string | null;
  tags?: string[] | null;
  archived: boolean;
  status?: string | null;
  client_id: string | null;
  client_name?: string | null;
  client_code?: string | null;
};

type ProjectColumn = "new" | "in_progress" | "blocked" | "complete";
type ProjectsViewTab = "list" | "board" | "archived";
type StatusFilter = "all" | ProjectColumn;
type ProjectsBootstrap = {
  accessToken: string | null;
  status: string;
  domainAllowed: boolean;
  clients: ClientRecord[];
  projects: Project[];
  latestFeaturedPosts: FeaturedFeedPost[];
};

const PROJECT_COLUMNS: { key: ProjectColumn; title: string; subtitle: string }[] = [
  { key: "new", title: "New", subtitle: "Ready to shape" },
  { key: "in_progress", title: "In Progress", subtitle: "Actively moving" },
  { key: "blocked", title: "Blocked", subtitle: "Needs a decision" },
  { key: "complete", title: "Complete", subtitle: "Ready to file away" }
];

const projectsBootstrapResource = createClientResource(loadProjectsBootstrap, () => "projects-home");

export default function ProjectsPage() {
  const [initial, setInitial] = useState<ProjectsBootstrap | null>(null);

  useEffect(() => {
    let cancelled = false;

    projectsBootstrapResource.read("projects-home").then((nextState) => {
      if (!cancelled) {
        setInitial(nextState);
      }
    });

    return () => {
      cancelled = true;
      projectsBootstrapResource.clear();
    };
  }, []);

  if (!initial) {
    return (
      <PageLoadingState
        label="Loading workspace"
        message="Gathering projects, clients, and the latest studio signals."
      />
    );
  }

  return <ProjectsPageContent initial={initial} />;
}

function ProjectsPageContent({ initial }: { initial: ProjectsBootstrap }) {
  const [accessToken, setAccessToken] = useState<string | null>(initial.accessToken);
  const [status, setStatus] = useState(initial.status);
  const [domainAllowed, setDomainAllowed] = useState(initial.domainAllowed);

  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const [latestFeaturedPosts, setLatestFeaturedPosts] = useState<FeaturedFeedPost[]>(initial.latestFeaturedPosts);
  const [activeTab, setActiveTab] = useState<ProjectsViewTab>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchValue, setSearchValue] = useState("");
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);

  const [projectForm, setProjectForm] = useState<ProjectDialogValues>(createProjectDialogValues());
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ProjectColumn | null>(null);
  const [justMovedProjectId, setJustMovedProjectId] = useState<string | null>(null);
  const [justUpdatedColumn, setJustUpdatedColumn] = useState<ProjectColumn | null>(null);

  const createDialogRef = useRef<HTMLDialogElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const moveFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function authedFetch(path: string, options: RequestInit = {}) {
    const { accessToken: nextToken, data } = await authedJsonFetch({
      accessToken,
      init: options,
      onToken: setAccessToken,
      path
    });
    if (nextToken !== accessToken) {
      setAccessToken(nextToken);
    }
    return data;
  }

  async function refreshClients(nextAccessToken = accessToken) {
    if (!nextAccessToken) {
      throw new Error("Missing access token");
    }

    const data = await authedFetch("/clients", {
      headers: {
        Authorization: `Bearer ${nextAccessToken}`
      }
    });
    const loaded = (data?.clients ?? []) as ClientRecord[];
    setClients(loaded);
    setProjectForm((current) =>
      current.clientId || !loaded[0]?.id
        ? current
        : {
          ...current,
          clientId: loaded[0].id
        }
    );
  }

  async function refreshProjects(nextAccessToken = accessToken) {
    if (!nextAccessToken) {
      throw new Error("Missing access token");
    }

    const data = await authedFetch("/projects?includeArchived=true", {
      headers: {
        Authorization: `Bearer ${nextAccessToken}`
      }
    });
    setProjects((data?.projects ?? []) as Project[]);
  }

  async function signIn() {
    window.location.href = "/auth/google/start";
  }

  async function signOut() {
    setDomainAllowed(false);
    setAccessToken(null);
    setProjects([]);
    setClients([]);
    setLatestFeaturedPosts([]);
    setStatus("Please sign in");
    projectsBootstrapResource.clear();
    window.location.href = "/auth/logout";
  }

  async function createProject() {
    setIsCreatingProject(true);
    try {
      await authedFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectForm.name,
          description: projectForm.description,
          deadline: projectForm.deadline || null,
          clientId: projectForm.clientId,
          tags: parseProjectTags(projectForm.tags),
          requestor: projectForm.requestor.trim() || null
        })
      });
      setProjectForm(createProjectDialogValues(clients[0]?.id ?? ""));
      createDialogRef.current?.close();
      await refreshProjects();
    } finally {
      setIsCreatingProject(false);
    }
  }

  function openCreateDialog() {
    setProjectForm(createProjectDialogValues(clients[0]?.id ?? ""));
    createDialogRef.current?.showModal();
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

  const activeProjects = projects.filter((project) => !project.archived);
  const archivedProjects = projects.filter((project) => project.archived);
  const deferredSearch = useDeferredValue(searchValue);
  const searchTerm = deferredSearch.trim().toLowerCase();

  function runWithTransition(update: () => void) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && "startViewTransition" in document) {
      // Progressive enhancement for cinematic state changes.
      (document as Document & { startViewTransition?: (callback: () => void) => void }).startViewTransition?.(update);
      return;
    }
    update();
  }

  function projectMatchesSearch(project: Project) {
    if (!searchTerm) return true;
    const blob = [
      project.display_name ?? project.name,
      project.description ?? "",
      project.client_name ?? "",
      project.client_code ?? "",
      project.status ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return blob.includes(searchTerm);
  }

  function projectMatchesStatus(project: Project) {
    return statusFilter === "all" ? true : normalizeProjectColumn(project) === statusFilter;
  }

  const filteredActiveProjects = useMemo(
    () => activeProjects.filter((project) => projectMatchesSearch(project) && projectMatchesStatus(project)),
    [activeProjects, searchTerm, statusFilter]
  );

  const filteredArchivedProjects = useMemo(
    () => archivedProjects.filter((project) => projectMatchesSearch(project) && projectMatchesStatus(project)),
    [archivedProjects, searchTerm, statusFilter]
  );

  const keyboardNavigableProjects = useMemo(
    () =>
      filteredActiveProjects
        .slice()
        .sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)),
    [filteredActiveProjects]
  );
  const statusSummaries = useMemo(() => {
    const total = Math.max(filteredActiveProjects.length, 1);
    return PROJECT_COLUMNS.map((column) => {
      const count = filteredActiveProjects.filter((project) => normalizeProjectColumn(project) === column.key).length;
      return {
        ...column,
        count,
        fillPercent: `${Math.round((count / total) * 100)}%`
      };
    });
  }, [filteredActiveProjects]);

  useEffect(() => {
    if (!keyboardNavigableProjects.length) {
      setHighlightedProjectId(null);
      return;
    }
    setHighlightedProjectId((current) =>
      current && keyboardNavigableProjects.some((project) => project.id === current) ? current : null
    );
  }, [keyboardNavigableProjects]);

  useEffect(() => {
    if (!highlightedProjectId) return;
    const element = document.querySelector<HTMLElement>(`[data-project-id="${highlightedProjectId}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [highlightedProjectId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (activeTab !== "list" || inEditable || !keyboardNavigableProjects.length) return;

      const currentIndex = keyboardNavigableProjects.findIndex((project) => project.id === highlightedProjectId);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, keyboardNavigableProjects.length - 1) : 0;
        setHighlightedProjectId(keyboardNavigableProjects[nextIndex].id);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.max(currentIndex - 1, 0) : 0;
        setHighlightedProjectId(keyboardNavigableProjects[nextIndex].id);
      } else if (event.key === "Enter" && highlightedProjectId) {
        event.preventDefault();
        window.location.href = `/${highlightedProjectId}`;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, keyboardNavigableProjects, highlightedProjectId]);

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
      return (
        <section className="projectsEmptyState">
          <p className="projectsEmptyEyebrow">{activeTab === "archived" ? "Archive" : "Clear surface"}</p>
          <h2>{emptyState}</h2>
          <p>
            {searchTerm || statusFilter !== "all"
              ? "Try widening the search or switching back to all statuses."
              : "Create a project and the index will start forming around your client work."}
          </p>
          {!searchTerm && statusFilter === "all" && activeTab !== "archived" && (
            <button type="button" className="projectPrimaryButton" onClick={openCreateDialog}>
              New project
            </button>
          )}
        </section>
      );
    }

    return (
      <div className="projectClientAtlas">
        {groups.map((group) => (
          <section key={group.label} className="clientLedgerSection">
            <header className="clientLedgerIntro">
              <div className="clientLedgerCopy">
                <p className="clientLedgerEyebrow">Client</p>
                <h2>{group.label}</h2>
                <p className="clientLedgerSummary">
                  {PROJECT_COLUMNS.map((column) => {
                    const count = group.projects.filter((project) => normalizeProjectColumn(project) === column.key).length;
                    if (!count) return null;
                    return (
                      <span key={column.key} className={`clientLedgerCount tone-${column.key}`}>
                        {count} {column.title.toLowerCase()}
                      </span>
                    );
                  })}
                </p>
              </div>
              <span className="clientLedgerTotal">{group.projects.length}</span>
            </header>
            <ul className="clientProjectLedger">
              {group.projects.map((project) => (
                <li
                  key={project.id}
                  className={`projectLedgerItem tone-${normalizeProjectColumn(project)} ${highlightedProjectId === project.id ? "projectLedgerItemActive" : ""}`}
                  data-project-id={project.id}
                  style={{ viewTransitionName: `project-${project.id}` } as CSSProperties}
                  onFocusCapture={() => setHighlightedProjectId(project.id)}
                  onBlurCapture={(event) => handleProjectRowBlur(event, project.id)}
                >
                  <div className="projectLedgerRail">
                    <span className="projectLedgerStatus">{getProjectStatusLabel(project)}</span>
                  </div>
                  <div className="projectMain projectLedgerBody">
                    <Link href={`/${project.id}`} className="projectLink projectTitle projectLedgerTitle">
                      {renderProjectTitle(project.display_name ?? project.name)}
                    </Link>
                    <p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
                    <ProjectTagList tags={project.tags} className="projectTagListCompact" />
                  </div>
                  {/* <div className="projectLedgerMeta">
                    <span className="projectClientPill">{getProjectClientLabel(project)}</span>
                  </div> */}
                  <div className="projectLedgerActions">
                    <Link href={`/${project.id}`} className="projectActionLink">
                      Open
                    </Link>
                    {/* <button
                      type="button"
                      className="projectActionButton"
                      title={project.archived ? "Restore project" : "Archive project"}
                      aria-label={project.archived ? "Restore project" : "Archive project"}
                      onClick={() => toggleArchive(project).catch((error) => setStatus(error.message))}
                    >
                      {project.archived ? "Restore" : "Archive"}
                    </button> */}
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

  function getProjectStatusLabel(project: Project) {
    return PROJECT_COLUMNS.find((column) => column.key === normalizeProjectColumn(project))?.title ?? "New";
  }

  async function moveProject(projectId: string, targetColumn: ProjectColumn) {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const currentColumn = normalizeProjectColumn(source);
    if (currentColumn === targetColumn) return;

    const previousProjects = projects;
    runWithTransition(() => {
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
    });

    try {
      await authedFetch(`/projects/${projectId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: targetColumn })
      });
      setJustMovedProjectId(projectId);
      setJustUpdatedColumn(targetColumn);
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
      moveFlashTimeoutRef.current = setTimeout(() => {
        setJustMovedProjectId(null);
        setJustUpdatedColumn(null);
      }, 900);
    } catch (error) {
      setProjects(previousProjects);
      throw error;
    }
  }

  useEffect(() => {
    return () => {
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
    };
  }, []);

  function selectTab(nextTab: ProjectsViewTab) {
    runWithTransition(() => {
      setActiveTab(nextTab);
    });
  }

  function handleCommandRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setSearchValue("");
      searchInputRef.current?.blur();
    }
  }

  function handleProjectRowBlur(event: FocusEvent<HTMLLIElement>, projectId: string) {
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setHighlightedProjectId((current) => (current === projectId ? null : current));
  }

  const visibleProjects = activeTab === "archived" ? filteredArchivedProjects : filteredActiveProjects;
  const visibleClients = new Set(visibleProjects.map((project) => getProjectClientLabel(project))).size;
  const featuredHeroPost = latestFeaturedPosts[0] ?? null;
  const feedRailPosts = latestFeaturedPosts.length > 1 ? latestFeaturedPosts.slice(1) : latestFeaturedPosts;
  const heroKicker = featuredHeroPost ? `Latest from ${featuredHeroPost.sourceName}` : "Projects index";
  const heroTitle = featuredHeroPost?.title ?? "A calmer way to see what the studio is carrying.";
  const heroIntro =
    featuredHeroPost?.description ??
    "The page should read like an active portfolio wall, not a template dashboard. Track what is moving, what is blocked, and which client lanes need attention next.";

  return (
    <main className="page projectsExperience">
      {/* Hero section */}
      <section className="projectsHero">
        <div className="projectsHeroCopy">
          <p className={`projectsSessionNote ${domainAllowed && status.startsWith("Signed in as") ? "projectsSessionNoteQuiet" : ""}`}>
            {status}
          </p>
          <>
            <p className="projectsKicker">{heroKicker}</p>
            <h1 className={`projectsHeroTitle ${featuredHeroPost ? "projectsHeroTitleFeed" : ""}`}>{heroTitle}</h1>
            <p className={`projectsHeroIntro ${featuredHeroPost ? "projectsHeroIntroFeed" : ""}`}>{heroIntro}</p>
            {featuredHeroPost && (
              <div className="projectsHeroUtilityRow">
                <div className="projectsHeaderActions">
                  <a href={featuredHeroPost.url} target="_blank" rel="noreferrer" className="projectPrimaryButton projectPrimaryButtonLink">
                    Read more
                  </a>
                </div>
              </div>
            )}
            {domainAllowed && (
              <div className="projectsHeroFacts" aria-label="Projects summary">
                <span>{filteredActiveProjects.length} active projects</span>
                <span>{new Set(filteredActiveProjects.map((project) => getProjectClientLabel(project))).size} live clients</span>
                <span>{archivedProjects.length} archived</span>
              </div>
            )}
          </>
        </div>
        <aside className="projectsFeedRail" aria-label="Latest feed posts">
          <p className="projectsFeedEyebrow">Latest posts</p>
          {feedRailPosts.length > 0 ? (
            <ul className="projectsFeedList">
              {feedRailPosts.map((post) => (
                <li key={`${post.url}-${post.publishedAt ?? "undated"}`} className="projectsFeedItem">
                  <div className="projectsFeedMeta">
                    <span>{post.sourceName}</span>
                    <span>{formatFeedDate(post.publishedAt)}</span>
                  </div>
                  <a href={post.url} target="_blank" rel="noreferrer" className="projectsFeedLink">
                    {post.title}
                  </a>
                  <p className="projectsFeedDescription">{post.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="projectsFeedFallback">
              <p>The feeds are quiet right now, so the homepage is keeping the focus on your project index.</p>
            </div>
          )}
        </aside>
      </section>
      {/* Workbench section */}
      {domainAllowed && (
        <section className="projectsWorkbench">
          <div className="projectsWorkbenchBar">
            <div className="projectsViewSwitch" role="tablist" aria-label="Projects views">
              <button
                className={`projectsViewButton ${activeTab === "list" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "list"}
                onClick={() => selectTab("list")}
              >
                Index
              </button>
              <button
                className={`projectsViewButton ${activeTab === "board" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "board"}
                onClick={() => selectTab("board")}
              >
                Flow
              </button>
              <button
                className={`projectsViewButton ${activeTab === "archived" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "archived"}
                onClick={() => selectTab("archived")}
              >
                Archive
              </button>
            </div>

            <div className="projectsWorkbenchActions">
              <button type="button" className="projectPrimaryButton" onClick={openCreateDialog}>
                New project
              </button>
            </div>
          </div>
          {activeTab !== "board" && (
            <>
              <section className="projectsFilterShelf" onKeyDown={handleCommandRowKeyDown}>
                <div className="projectsFilterControls">
                  <label className="projectsSearchShell">
                    <span className="projectsSearchLabel sr-only">Find</span>
                    <input
                      ref={searchInputRef}
                      className="projectsSearchInput"
                      value={searchValue}
                      onChange={(event) => setSearchValue(event.target.value)}
                      placeholder="Search project names, clients, or status"
                      aria-label="Search projects"
                    />
                    <span className="projectsSearchHint">/</span>
                  </label>
                </div>
                <div className="projectsResultsMeta">
                  <p className="projectsResultsNote">
                    {visibleProjects.length} showing across {visibleClients} clients
                  </p>
                </div>
              </section>
              {activeTab !== "archived" && (
                <div className="projectsPulseRow" aria-label="Filter search results by status">
                  {statusSummaries.map((item) => (
                    <button
                      key={item.key}
                      className={`projectsPulseButton tone-${item.key} ${statusFilter === item.key ? "projectsPulseButtonActive" : ""}`}
                      onClick={() => setStatusFilter((current) => (current === item.key ? "all" : item.key))}
                      aria-pressed={statusFilter === item.key}
                      aria-label={`${item.title}: ${item.count} project${item.count === 1 ? "" : "s"}`}
                    >
                      <span>{item.title}</span>
                      <strong>{item.count}</strong>
                    </button>
                  ))}
                </div>

              )}
            </>
          )}
        </section>
      )}

      {/* Viewport section */}
      {domainAllowed && (
        <div className="projectsViewport">
          {activeTab === "list" &&
            renderProjectList(
              filteredActiveProjects,
              searchTerm || statusFilter !== "all" ? "No projects match this edit of the index." : "No active projects yet."
            )}
          {activeTab === "board" && (
            <div className="projectFlowGrid">
              {PROJECT_COLUMNS.map((column) => {
                const columnProjects = filteredActiveProjects.filter(
                  (project) => normalizeProjectColumn(project) === column.key
                );
                return (
                  <section
                    key={column.key}
                    className={`projectFlowColumn tone-${column.key} ${dragOverColumn === column.key ? "projectFlowColumnDropTarget" : ""}`}
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
                    <header className="projectFlowColumnHeader">
                      <div>
                        <p className="projectFlowEyebrow">{column.subtitle}</p>
                        <h2>{column.title}</h2>
                      </div>
                      <span key={`${column.key}-${columnProjects.length}`} className={justUpdatedColumn === column.key ? "projectFlowCountFlash" : ""}>
                        {columnProjects.length}
                      </span>
                    </header>

                    <ul className="projectFlowList">
                      {columnProjects.map((project) => (
                        <li
                          key={project.id}
                          className={`projectFlowCard ${draggingProjectId === project.id ? "projectFlowCardDragging" : ""} ${justMovedProjectId === project.id ? "projectFlowCardSettled" : ""}`}
                          style={{ viewTransitionName: `project-${project.id}` } as CSSProperties}
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
                          <div className="projectMain projectFlowCardBody">
                            <Link href={`/${project.id}`} className="projectLink projectTitle projectFlowCardTitle">
                              {renderProjectTitle(project.display_name ?? project.name)}
                            </Link>
                            <p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
                            <ProjectTagList tags={project.tags} className="projectTagListCompact" />
                          </div>
                          <div className="projectFlowCardFoot">
                            <span className="projectClientPill">
                              {project.client_code?.trim() || project.client_name?.trim() || "No client"}
                            </span>
                            <div className="projectFlowCardActions">
                              <Link href={`/${project.id}`} className="projectActionLink">
                                Open
                              </Link>
                              <button
                                type="button"
                                className="projectActionButton"
                                onClick={() => toggleArchive(project).catch((error) => setStatus(error.message))}
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {activeTab === "archived" &&
            renderProjectList(
              filteredArchivedProjects,
              searchTerm ? "No archived projects match this search." : "No archived projects are parked here yet."
            )}
        </div>
      )}

      {/* Create project dialog */}
      <dialog ref={createDialogRef} className="dialog">
        <ProjectDialogForm
          title="Create Project"
          submitLabel="Create"
          values={projectForm}
          clients={clients}
          submitting={isCreatingProject}
          onChange={setProjectForm}
          onSubmit={() => createProject().catch((error) => setStatus(error.message))}
          onCancel={() => createDialogRef.current?.close()}
        />
      </dialog>
    </main>
  );
}

function formatFeedDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "No date";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
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

function createProjectDialogValues(clientId = ""): ProjectDialogValues {
  return {
    name: "",
    description: "",
    deadline: "",
    requestor: "",
    tags: "",
    clientId
  };
}

function getProjectsPageAuthErrorStatus() {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("authError");
  if (authError === "workspace-domain") {
    return "Only workspace accounts can sign in.";
  }
  if (authError === "oauth-session-exchange") {
    return "Google sign-in completed, but the session exchange failed. Try again.";
  }
  if (authError === "oauth-session-missing") {
    return "Google sign-in completed without a session. Try again.";
  }
  if (authError === "oauth-missing-email") {
    return "Google did not return an email address for this account.";
  }
  if (authError === "oauth-callback-failed") {
    return "Google sign-in did not complete successfully.";
  }
  return null;
}

async function loadProjectsBootstrap(): Promise<ProjectsBootstrap> {
  let latestFeaturedPosts: FeaturedFeedPost[] = [];

  try {
    const feedResponse = await fetch("/feeds/latest", { cache: "no-store" });
    if (feedResponse.ok) {
      const feedData = (await feedResponse.json()) as { posts?: FeaturedFeedPost[] };
      latestFeaturedPosts = feedData.posts?.slice(0, 2) ?? [];
    }
  } catch {
    // Keep the default hero copy if the feed cannot be reached.
  }

  try {
    const session = await fetchAuthSession();
    const accessToken = session.accessToken;
    const email = session.user?.email ?? null;

    if (!accessToken || !email) {
      return {
        accessToken: null,
        status: getProjectsPageAuthErrorStatus() ?? session.status,
        domainAllowed: session.domainAllowed,
        clients: [],
        projects: [],
        latestFeaturedPosts
      };
    }

    const [clientsResponse, projectsResponse] = await Promise.all([
      authedJsonFetch({ accessToken, path: "/clients" }),
      authedJsonFetch({ accessToken, path: "/projects?includeArchived=true" })
    ]);

    return {
      accessToken: clientsResponse.accessToken,
      status: session.status,
      domainAllowed: session.domainAllowed,
      clients: (clientsResponse.data?.clients ?? []) as ClientRecord[],
      projects: (projectsResponse.data?.projects ?? []) as Project[],
      latestFeaturedPosts
    };
  } catch (error) {
    return {
      accessToken: null,
      status: error instanceof Error ? error.message : "Unable to load workspace",
      domainAllowed: false,
      clients: [],
      projects: [],
      latestFeaturedPosts
    };
  }
}
