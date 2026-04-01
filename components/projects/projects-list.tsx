"use client";

import { OneShotButton } from "@/components/one-shot-button";
import { ProjectsListView } from "@/components/projects/projects-list-view";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import {
  useProjectsWorkspace,
  type Project,
  type ProjectColumn,
  type ProjectSort
} from "@/components/projects/projects-workspace-context";
import { normalizeProjectColumn } from "@/lib/project-utils";
import { type FocusEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type StatusFilter = "all" | ProjectColumn;

export function ProjectsList() {
  const {
    domainAllowed,
    activeProjects,
    projectColumns,
    openCreateDialog,
    renderProjectTitle,
    getProjectStatusLabel,
    getProjectClientLabel,
    filterClientId,
    setFilterClientId,
    activeSearch,
    setActiveSearch,
    projectSort,
    setProjectSort,
    refreshProjects
  } = useProjectsWorkspace();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchValue, setSearchValue] = useState(activeSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(activeSearch);
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasMountedQueryEffectRef = useRef(false);

  const trimmedSearchValue = debouncedSearch.trim();
  const effectiveSearch = trimmedSearchValue.length >= 2 ? trimmedSearchValue : "";

  function projectMatchesStatus(project: Project) {
    return statusFilter === "all" ? true : normalizeProjectColumn(project) === statusFilter;
  }

  const filteredActiveProjects = useMemo(
    () => activeProjects.filter((project) => projectMatchesStatus(project)),
    [activeProjects, statusFilter]
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
    return projectColumns.map((column) => {
      const count = filteredActiveProjects.filter((project) => normalizeProjectColumn(project) === column.key).length;
      return {
        ...column,
        count,
        fillPercent: `${Math.round((count / total) * 100)}%`
      };
    });
  }, [filteredActiveProjects, projectColumns]);

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
    setSearchValue(activeSearch);
    setDebouncedSearch(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    if (!hasMountedQueryEffectRef.current) {
      hasMountedQueryEffectRef.current = true;
      return;
    }

    setActiveSearch(effectiveSearch);
    void refreshProjects({
      clientId: filterClientId,
      search: effectiveSearch,
      sort: projectSort
    });
  }, [effectiveSearch, filterClientId, projectSort, refreshProjects, setActiveSearch]);

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

      if (inEditable || !keyboardNavigableProjects.length) return;

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
  }, [keyboardNavigableProjects, highlightedProjectId]);

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

  const visibleProjects = filteredActiveProjects;
  const visibleClients = new Set(visibleProjects.map((project) => getProjectClientLabel(project))).size;

  const derivedClientOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const project of visibleProjects) {
      const cid = project.client_id?.trim();
      if (!cid) continue;
      if (!byId.has(cid)) {
        byId.set(cid, { id: cid, label: getProjectClientLabel(project) });
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleProjects, getProjectClientLabel]);

  const derivedClientIds = useMemo(() => new Set(derivedClientOptions.map((o) => o.id)), [derivedClientOptions]);

  const clientFilterDisabled = Boolean(filterClientId && !derivedClientIds.has(filterClientId));

  const workbench =
    domainAllowed ? (
      <>
        <section className="projectsFilterShelf" onKeyDown={handleCommandRowKeyDown}>
          <div className="projectsFilterControls">
            <div className="projectsFilterToolbar">
              <label className="projectsFilterField projectsClientFilterField">
                <span className="projectsFilterLabel">Client</span>
                <select
                  className="projectsClientSelect"
                  value={filterClientId ?? ""}
                  onChange={(event) => setFilterClientId(event.target.value || null)}
                  aria-label="Filter projects by client"
                  disabled={clientFilterDisabled}
                >
                  <option value="">All clients</option>
                  {derivedClientOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="projectsFilterField projectsClientFilterField">
                <span className="projectsFilterLabel">Sort</span>
                <select
                  className="projectsClientSelect"
                  value={projectSort}
                  onChange={(event) => setProjectSort(event.target.value as ProjectSort)}
                  aria-label="Sort projects"
                  disabled={effectiveSearch.length >= 2}
                >
                  <option value="title">Title A–Z</option>
                  <option value="created">Newest First</option>
                </select>
              </label>
              <label className="projectsFilterField projectsSearchShell">
                <span className="projectsSearchLabel sr-only">Find</span>
                <input
                  ref={searchInputRef}
                  className="projectsSearchInput"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search projects, discussions, or files"
                  aria-label="Search projects"
                />
                <span className="projectsSearchHint">/</span>
              </label>
            </div>
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
    ) : null;

  const viewport = domainAllowed ? (
    <ProjectsListView
      items={filteredActiveProjects}
      projectColumns={projectColumns}
      activeTab="list"
      hasSearchOrFilter={Boolean(activeSearch || filterClientId || statusFilter !== "all")}
      highlightedProjectId={highlightedProjectId}
      emptyState={
        activeSearch || filterClientId || statusFilter !== "all"
          ? "No projects match this edit of the index."
          : "No active projects yet."
      }
      onOpenCreateDialog={openCreateDialog}
      onHighlightProject={setHighlightedProjectId}
      onProjectBlur={handleProjectRowBlur}
      renderProjectTitle={renderProjectTitle}
      getProjectStatusLabel={getProjectStatusLabel}
      getProjectClientLabel={getProjectClientLabel}
    />
  ) : null;

  return <ProjectsWorkspaceShell workbench={workbench} viewport={viewport} />;
}
