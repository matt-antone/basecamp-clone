"use client";

import { OneShotButton } from "@/components/one-shot-button";
import { ProjectsFilterShelf } from "@/components/projects/projects-filter-shelf";
import { ProjectsListView } from "@/components/projects/projects-list-view";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import {
  useProjectsWorkspace,
  type Project,
  type ProjectColumn
} from "@/components/projects/projects-workspace-context";
import { useProjectsFilterShelf } from "@/components/projects/use-projects-filter-shelf";
import { normalizeProjectColumn } from "@/lib/project-utils";
import { type FocusEvent, useEffect, useMemo, useState } from "react";

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
    activeSearch
  } = useProjectsWorkspace();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);

  function projectMatchesStatus(project: Project) {
    return statusFilter === "all" ? true : normalizeProjectColumn(project) === statusFilter;
  }

  const filteredActiveProjects = useMemo(
    () => activeProjects.filter((project) => projectMatchesStatus(project)),
    [activeProjects, statusFilter]
  );

  const filterShelf = useProjectsFilterShelf(filteredActiveProjects);

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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        filterShelf.searchInputRef.current?.focus();
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
  }, [keyboardNavigableProjects, highlightedProjectId, filterShelf.searchInputRef]);

  function handleProjectRowBlur(event: FocusEvent<HTMLLIElement>, projectId: string) {
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setHighlightedProjectId((current) => (current === projectId ? null : current));
  }

  const visibleProjects = filteredActiveProjects;
  const visibleClients = new Set(visibleProjects.map((project) => getProjectClientLabel(project))).size;

  const workbench = domainAllowed ? (
    <>
      <ProjectsFilterShelf
        searchValue={filterShelf.searchValue}
        searchInputRef={filterShelf.searchInputRef}
        onSearchChange={filterShelf.setSearchValue}
        effectiveSearchActive={filterShelf.effectiveSearch.length >= 2}
        filterClientId={filterShelf.filterClientId}
        setFilterClientId={filterShelf.setFilterClientId}
        derivedClientOptions={filterShelf.derivedClientOptions}
        clientFilterDisabled={filterShelf.clientFilterDisabled}
        projectSort={filterShelf.projectSort}
        setProjectSort={filterShelf.setProjectSort}
        onKeyDown={filterShelf.handleCommandRowKeyDown}
        resultCount={visibleProjects.length}
        clientCount={visibleClients}
      />
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
      hasSearchOrFilter={Boolean(activeSearch || filterShelf.filterClientId || statusFilter !== "all")}
      highlightedProjectId={highlightedProjectId}
      emptyState={
        activeSearch || filterShelf.filterClientId || statusFilter !== "all"
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
