"use client";

import type { ProjectDialogValues } from "@/components/project-dialog-form";
import { PageLoadingState } from "@/components/loading-shells";
import { createClientResource } from "@/lib/client-resource";
import { createProjectDialogValues, normalizeProjectColumn, parseProjectTags } from "@/lib/project-utils";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import type { FeaturedFeedPost } from "@/lib/featured-feed";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

export type ClientRecord = { id: string; name: string; code: string };
export type Project = {
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

export type ProjectColumn = "new" | "in_progress" | "blocked" | "complete";

export const PROJECT_COLUMNS: { key: ProjectColumn; title: string; subtitle: string }[] = [
  { key: "new", title: "New", subtitle: "Ready to shape" },
  { key: "in_progress", title: "In Progress", subtitle: "Actively moving" },
  { key: "blocked", title: "Blocked", subtitle: "Needs a decision" },
  { key: "complete", title: "Complete", subtitle: "Ready to file away" }
];

type ProjectsBootstrap = {
  accessToken: string | null;
  status: string;
  domainAllowed: boolean;
  clients: ClientRecord[];
  projects: Project[];
  latestFeaturedPosts: FeaturedFeedPost[];
};

export type ProjectsWorkspaceContextValue = {
  accessToken: string | null;
  setAccessToken: (t: string | null) => void;
  status: string;
  setStatus: (s: string) => void;
  domainAllowed: boolean;
  clients: ClientRecord[];
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  latestFeaturedPosts: FeaturedFeedPost[];
  projectColumns: typeof PROJECT_COLUMNS;
  activeProjects: Project[];
  authedFetch: (path: string, options?: RequestInit) => Promise<unknown>;
  refreshProjects: (nextAccessToken?: string | null) => Promise<void>;
  createProject: () => Promise<void>;
  openCreateDialog: () => void;
  createDialogRef: RefObject<HTMLDialogElement | null>;
  projectForm: ProjectDialogValues;
  setProjectForm: Dispatch<SetStateAction<ProjectDialogValues>>;
  isCreatingProject: boolean;
  toggleArchive: (project: Project) => Promise<void>;
  moveProject: (projectId: string, targetColumn: ProjectColumn) => Promise<void>;
  getProjectClientLabel: (project: Project) => string;
  renderProjectTitle: (title: string) => ReactNode;
  getProjectStatusLabel: (project: Project) => string;
};

const ProjectsWorkspaceContext = createContext<ProjectsWorkspaceContextValue | null>(null);

export function useProjectsWorkspace() {
  const ctx = useContext(ProjectsWorkspaceContext);
  if (!ctx) {
    throw new Error("useProjectsWorkspace must be used within ProjectsWorkspaceProvider");
  }
  return ctx;
}

const projectsBootstrapResource = createClientResource(loadProjectsBootstrap, () => "projects-home");

export function ProjectsWorkspaceProvider({ children }: { children: React.ReactNode }) {
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

  return <ProjectsWorkspaceInner initial={initial}>{children}</ProjectsWorkspaceInner>;
}

function ProjectsWorkspaceInner({ initial, children }: { initial: ProjectsBootstrap; children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(initial.accessToken);
  const [status, setStatus] = useState(initial.status);
  const domainAllowed = initial.domainAllowed;
  const clients = initial.clients;
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const latestFeaturedPosts = initial.latestFeaturedPosts;

  const [projectForm, setProjectForm] = useState<ProjectDialogValues>(createProjectDialogValues());
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const createDialogRef = useRef<HTMLDialogElement | null>(null);

  const activeProjects = useMemo(() => projects.filter((project) => !project.archived), [projects]);

  const authedFetch = useCallback(async (path: string, options: RequestInit = {}) => {
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
  }, [accessToken]);

  const refreshProjects = useCallback(
    async (nextAccessToken = accessToken) => {
      if (!nextAccessToken) {
        throw new Error("Missing access token");
      }
      const data = await authedFetch("/projects?includeArchived=true", {
        headers: {
          Authorization: `Bearer ${nextAccessToken}`
        }
      });
      setProjects((data?.projects ?? []) as Project[]);
    },
    [accessToken, authedFetch]
  );

  const createProject = useCallback(async () => {
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
  }, [authedFetch, clients, projectForm, refreshProjects]);

  const openCreateDialog = useCallback(() => {
    setProjectForm(createProjectDialogValues(clients[0]?.id ?? ""));
    createDialogRef.current?.showModal();
  }, [clients]);

  const toggleArchive = useCallback(
    async (project: Project) => {
      await authedFetch(`/projects/${project.id}/${project.archived ? "restore" : "archive"}`, { method: "POST" });
      await refreshProjects();
    },
    [authedFetch, refreshProjects]
  );

  function runWithTransition(update: () => void) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && "startViewTransition" in document) {
      (document as Document & { startViewTransition?: (callback: () => void) => void }).startViewTransition?.(update);
      return;
    }
    update();
  }

  const moveProject = useCallback(
    async (projectId: string, targetColumn: ProjectColumn) => {
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
      } catch (error) {
        setProjects(previousProjects);
        throw error;
      }
    },
    [authedFetch, projects]
  );

  const getProjectClientLabel = useCallback((project: Project) => {
    return project.client_name?.trim() || project.client_code?.trim() || "No client";
  }, []);

  const renderProjectTitle = useCallback((title: string) => {
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
  }, []);

  const getProjectStatusLabel = useCallback((project: Project) => {
    return PROJECT_COLUMNS.find((column) => column.key === normalizeProjectColumn(project))?.title ?? "New";
  }, []);

  const value: ProjectsWorkspaceContextValue = {
    accessToken,
    setAccessToken,
    status,
    setStatus,
    domainAllowed,
    clients,
    projects,
    setProjects,
    latestFeaturedPosts,
    projectColumns: PROJECT_COLUMNS,
    activeProjects,
    authedFetch,
    refreshProjects,
    createProject,
    openCreateDialog,
    createDialogRef,
    projectForm,
    setProjectForm,
    isCreatingProject,
    toggleArchive,
    moveProject,
    getProjectClientLabel,
    renderProjectTitle,
    getProjectStatusLabel
  };

  return <ProjectsWorkspaceContext.Provider value={value}>{children}</ProjectsWorkspaceContext.Provider>;
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
