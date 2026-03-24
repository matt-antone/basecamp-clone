"use client";

import Link from "next/link";
import { ProjectTagList } from "@/components/project-tag-list";
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
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type SessionUser = { id: string; email?: string };
type ClientRecord = { id: string; name: string; code: string };
type Project = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
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

const PROJECT_COLUMNS: { key: ProjectColumn; title: string; subtitle: string }[] = [
  { key: "new", title: "New", subtitle: "Ready to shape" },
  { key: "in_progress", title: "In Progress", subtitle: "Actively moving" },
  { key: "blocked", title: "Blocked", subtitle: "Needs a decision" },
  { key: "complete", title: "Complete", subtitle: "Ready to file away" }
];

export default function ProjectsPage() {
  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [domainAllowed, setDomainAllowed] = useState(false);

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [latestFeaturedPost, setLatestFeaturedPost] = useState<FeaturedFeedPost | null>(null);
  const [isFeaturedFeedLoading, setIsFeaturedFeedLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectsViewTab>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchValue, setSearchValue] = useState("");
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectClientId, setNewProjectClientId] = useState("");
  const [newProjectTags, setNewProjectTags] = useState("");
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ProjectColumn | null>(null);
  const [justMovedProjectId, setJustMovedProjectId] = useState<string | null>(null);
  const [justUpdatedColumn, setJustUpdatedColumn] = useState<ProjectColumn | null>(null);

  const createDialogRef = useRef<HTMLDialogElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const moveFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    let isActive = true;

    fetch("/feeds/latest")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Feed request failed: ${response.status}`);
        }

        const data = (await response.json()) as { post?: FeaturedFeedPost };
        if (isActive && data.post) {
          setLatestFeaturedPost(data.post);
        }
      })
      .catch(() => {
        // Keep the default hero copy if the feed cannot be reached.
      })
      .finally(() => {
        if (isActive) {
          setIsFeaturedFeedLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
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
    const tags = Array.from(
      new Set(
        newProjectTags
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      )
    );

    await authedFetch("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: newProjectName,
        description: newProjectDescription,
        clientId: newProjectClientId,
        tags
      })
    });
    setNewProjectName("");
    setNewProjectDescription("");
    setNewProjectTags("");
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
            <button type="button" className="projectPrimaryButton" onClick={() => createDialogRef.current?.showModal()}>
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

  function getSpotlightProject() {
    return (
      filteredActiveProjects.find((project) => normalizeProjectColumn(project) === "blocked") ??
      filteredActiveProjects.find((project) => normalizeProjectColumn(project) === "in_progress") ??
      filteredActiveProjects[0] ??
      null
    );
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
  const spotlightProject = domainAllowed ? getSpotlightProject() : null;
  const spotlightStatus = spotlightProject ? normalizeProjectColumn(spotlightProject) : null;
  const spotlightEyebrow =
    spotlightStatus === "blocked"
      ? "Needs intervention"
      : spotlightStatus === "in_progress"
        ? "Currently moving"
        : spotlightStatus === "complete"
          ? "Recently wrapped"
          : "Ready to start";
  const isHeroFeedLoading = isFeaturedFeedLoading && !latestFeaturedPost;
  const heroKicker = latestFeaturedPost ? `Latest from ${latestFeaturedPost.sourceName}` : "Projects index";
  const heroTitle = latestFeaturedPost?.title ?? "A calmer way to see what the studio is carrying.";
  const heroIntro =
    latestFeaturedPost?.description ??
    "The page should read like an active portfolio wall, not a template dashboard. Track what is moving, what is blocked, and which client lanes need attention next.";

  return (
    <main className="page projectsExperience">
      {/* Hero section */}
      <section className="projectsHero">
        <div className="projectsHeroCopy">
          <p className={`projectsSessionNote ${domainAllowed && status.startsWith("Signed in as") ? "projectsSessionNoteQuiet" : ""}`}>
            {status}
          </p>
          {isHeroFeedLoading ? (
            <div className="projectsHeroSkeleton" role="status" aria-live="polite" aria-label="Loading featured article">
              <span className="visuallyHidden">Loading featured article</span>
              <div className="projectsHeroSkeletonLine projectsHeroSkeletonKicker" aria-hidden="true" />
              <div className="projectsHeroSkeletonTitleGroup" aria-hidden="true">
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonTitle projectsHeroSkeletonTitleLong" />
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonTitle projectsHeroSkeletonTitleShort" />
              </div>
              <div className="projectsHeroSkeletonIntroGroup" aria-hidden="true">
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonIntro projectsHeroSkeletonIntroFull" />
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonIntro projectsHeroSkeletonIntroFull" />
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonIntro projectsHeroSkeletonIntroShort" />
              </div>
              <div className="projectsHeroUtilityRow" aria-hidden="true">
                <div className="projectsHeroSkeletonLine projectsHeroSkeletonButton" />
              </div>
            </div>
          ) : (
            <>
              <p className="projectsKicker">{heroKicker}</p>
              <h1 className={`projectsHeroTitle ${latestFeaturedPost ? "projectsHeroTitleFeed" : ""}`}>{heroTitle}</h1>
              <p className={`projectsHeroIntro ${latestFeaturedPost ? "projectsHeroIntroFeed" : ""}`}>{heroIntro}</p>
              {latestFeaturedPost && (
                <div className="projectsHeroUtilityRow">
                  <div className="projectsHeaderActions">
                    <a
                      href={latestFeaturedPost.url}
                      target="_blank"
                      rel="noreferrer"
                      className="projectPrimaryButton projectPrimaryButtonLink"
                    >
                      Read more
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <aside className={`projectsSpotlight ${spotlightStatus ? `spotlight-${spotlightStatus}` : ""}`}>
          {domainAllowed && spotlightProject ? (
            <div className="projectsSpotlightCard">
              <p className="projectsSpotlightEyebrow">{spotlightEyebrow}</p>
              <Link href={`/${spotlightProject.id}`} className="projectsSpotlightTitle">
                {renderProjectTitle(spotlightProject.display_name ?? spotlightProject.name)}
              </Link>
              <p className="projectsSpotlightBody">
                {spotlightProject.description?.trim() || "No brief yet. Open the project workspace and shape the next move."}
              </p>
              <ProjectTagList tags={spotlightProject.tags} className="projectsSpotlightTags" />
              <div className="projectsSpotlightMeta">
                <span>{getProjectClientLabel(spotlightProject)}</span>
                <span>{getProjectStatusLabel(spotlightProject)}</span>
              </div>
              <div className="projectsSpotlightActions">
                <Link href={`/${spotlightProject.id}`} className="projectPrimaryButton projectPrimaryButtonLink">
                  Open workspace
                </Link>
                <button type="button" className="projectActionButton" onClick={() => selectTab("board")}>
                  View flow
                </button>
              </div>
            </div>
          ) : domainAllowed ? (
            <div className="projectsSpotlightCard">
              <p className="projectsSpotlightEyebrow">Blank slate</p>
              <h2 className="projectsSpotlightTitleStatic">The surface is ready for the first project.</h2>
              <p className="projectsSpotlightBody">
                Start with a single active project and the page will build the client rhythm around it.
              </p>
              <div className="projectsSpotlightActions">
                <button type="button" className="projectPrimaryButton" onClick={() => createDialogRef.current?.showModal()}>
                  New project
                </button>
              </div>
            </div>
          ) : (
            <div className="projectsSpotlightCard">
              <p className="projectsSpotlightEyebrow">Private workspace</p>
              <h2 className="projectsSpotlightTitleStatic">Sign in to open the live project index.</h2>
              <p className="projectsSpotlightBody">
                Use your workspace Google account to load client work, discussion threads, and the project board.
              </p>
              <div className="projectsSpotlightActions">
                <button type="button" className="projectPrimaryButton" onClick={signIn}>
                  Sign in with Google
                </button>
              </div>
            </div>
          )}
          {domainAllowed && (
            <div className="projectsHeroFacts projectsSpotlightFacts" aria-label="Projects summary">
              <span>{filteredActiveProjects.length} active projects</span>
              <span>{new Set(filteredActiveProjects.map((project) => getProjectClientLabel(project))).size} live clients</span>
              <span>{archivedProjects.length} archived</span>
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
              <button type="button" className="projectPrimaryButton" onClick={() => createDialogRef.current?.showModal()}>
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
        <form method="dialog" className="dialogForm">
          <h3>Create Project</h3>
          <div className="form">
            <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name" />
            <input
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              placeholder="Description"
            />
            <input
              value={newProjectTags}
              onChange={(e) => setNewProjectTags(e.target.value)}
              placeholder="Tags (comma separated)"
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
