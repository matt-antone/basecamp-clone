"use client";

import { PageLoadingState } from "@/components/loading-shells";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectDialogForm, type ProjectDialogValues } from "@/components/project-dialog-form";
import { ArchiveTab } from "@/components/projects/archive-tab";
import type { ArchiveProjectItem } from "@/components/projects/archive-project-row";
import { ProjectsBoardView } from "@/components/projects/projects-board-view";
import { ProjectsListView } from "@/components/projects/projects-list-view";
import { createClientResource } from "@/lib/client-resource";
import { createProjectDialogValues, normalizeProjectColumn, parseProjectTags } from "@/lib/project-utils";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import type { FeaturedFeedPost } from "@/lib/featured-feed";
import { projectsViewTabFromPathname } from "@/lib/projects-view-path";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

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

export default function ProjectsWorkspacePage() {
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
      // Intentionally do not call projectsBootstrapResource.clear() here so /, /flow, /archive
      // navigations reuse bootstrap; full page loads (e.g. after logout) reset module state.
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
  const pathname = usePathname();
  const activeTab = projectsViewTabFromPathname(pathname);

  const [accessToken, setAccessToken] = useState<string | null>(initial.accessToken);
  const [status, setStatus] = useState(initial.status);
  const domainAllowed = initial.domainAllowed;

  const clients = initial.clients;
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const latestFeaturedPosts = initial.latestFeaturedPosts;
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

  const activeProjects = projects.filter((project) => !project.archived);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const archivedProjects = projects.filter((project) => project.archived);
  const deferredSearch = useDeferredValue(searchValue);
  const searchTerm = deferredSearch.trim().toLowerCase();

  function runWithTransition(update: () => void) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && "startViewTransition" in document) {
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

  function handleBoardColumnDragOver(event: DragEvent<HTMLElement>, column: ProjectColumn) {
    event.preventDefault();
    setDragOverColumn(column);
  }

  function handleBoardColumnDragLeave(column: ProjectColumn) {
    setDragOverColumn((current) => (current === column ? null : current));
  }

  function handleBoardColumnDrop(event: DragEvent<HTMLElement>, column: ProjectColumn) {
    event.preventDefault();
    const draggedProjectId = event.dataTransfer.getData("text/plain");
    setDragOverColumn(null);
    setDraggingProjectId(null);
    if (!draggedProjectId) return;
    moveProject(draggedProjectId, column).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Failed to move project");
    });
  }

  function handleBoardCardDragStart(event: DragEvent<HTMLLIElement>, projectId: string) {
    event.dataTransfer.setData("text/plain", projectId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingProjectId(projectId);
  }

  function handleBoardCardDragEnd() {
    setDraggingProjectId(null);
    setDragOverColumn(null);
  }

  const visibleProjects = filteredActiveProjects;
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
      {domainAllowed && (
        <section className="projectsWorkbench">
          <div className="projectsWorkbenchBar">
            <div className="projectsViewSwitch" role="tablist" aria-label="Projects views">
              <Link
                href="/"
                className={`projectsViewButton ${activeTab === "list" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "list"}
                scroll={false}
              >
                Index
              </Link>
              <Link
                href="/flow"
                className={`projectsViewButton ${activeTab === "board" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "board"}
                scroll={false}
              >
                Flow
              </Link>
              <Link
                href="/archive"
                className={`projectsViewButton ${activeTab === "archived" ? "projectsViewButtonActive" : ""}`}
                role="tab"
                aria-selected={activeTab === "archived"}
                scroll={false}
              >
                Archive
              </Link>
            </div>

            <div className="projectsWorkbenchActions">
              <OneShotButton type="button" className="projectPrimaryButton" onClick={openCreateDialog}>
                New project
              </OneShotButton>
            </div>
          </div>
          {activeTab === "list" && (
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
              <div className="projectsPulseRow" aria-label="Filter search results by status">
                {statusSummaries.map((item) => (
                  <OneShotButton
                    key={item.key}
                    className={`projectsPulseButton tone-${item.key} ${statusFilter === item.key ? "projectsPulseButtonActive" : ""}`}
                    onClick={() => setStatusFilter((current) => (current === item.key ? "all" : item.key))}
                    aria-pressed={statusFilter === item.key}
                    aria-label={`${item.title}: ${item.count} project${item.count === 1 ? "" : "s"}`}
                  >
                    <span>{item.title}</span>
                    <strong>{item.count}</strong>
                  </OneShotButton>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {domainAllowed && (
        <div className="projectsViewport">
          {activeTab === "list" && (
            <ProjectsListView
              items={filteredActiveProjects}
              projectColumns={PROJECT_COLUMNS}
              activeTab="list"
              hasSearchOrFilter={Boolean(searchTerm || statusFilter !== "all")}
              highlightedProjectId={highlightedProjectId}
              emptyState={searchTerm || statusFilter !== "all" ? "No projects match this edit of the index." : "No active projects yet."}
              onOpenCreateDialog={openCreateDialog}
              onHighlightProject={setHighlightedProjectId}
              onProjectBlur={handleProjectRowBlur}
              renderProjectTitle={renderProjectTitle}
              getProjectStatusLabel={getProjectStatusLabel}
              getProjectClientLabel={getProjectClientLabel}
            />
          )}
          {activeTab === "board" && (
            <ProjectsBoardView
              items={filteredActiveProjects}
              projectColumns={PROJECT_COLUMNS}
              dragOverColumn={dragOverColumn}
              draggingProjectId={draggingProjectId}
              justMovedProjectId={justMovedProjectId}
              justUpdatedColumn={justUpdatedColumn}
              renderProjectTitle={renderProjectTitle}
              onColumnDragOver={handleBoardColumnDragOver}
              onColumnDragLeave={handleBoardColumnDragLeave}
              onColumnDrop={handleBoardColumnDrop}
              onCardDragStart={handleBoardCardDragStart}
              onCardDragEnd={handleBoardCardDragEnd}
              onArchiveProject={(project) => toggleArchive(project).catch((error) => setStatus(error.message))}
            />
          )}
          {activeTab === "archived" && (
            <ArchiveTab
              accessToken={accessToken}
              onToken={setAccessToken}
              onRestore={async (project: ArchiveProjectItem) => {
                await toggleArchive({ ...project, archived: true } as Project);
              }}
            />
          )}
        </div>
      )}

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
    const feedResponse = await fetch("/feeds/latest", { cache: "force-cache" });
    if (feedResponse.ok) {
      const feedData = (await feedResponse.json()) as { posts?: FeaturedFeedPost[] };
      latestFeaturedPosts = feedData.posts?.slice(0, 2) ?? [];
    }
  } catch {
    /* Keep the default hero copy if the feed cannot be reached. */
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
