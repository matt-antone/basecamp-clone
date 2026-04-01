"use client";

import { ProjectsBoardView } from "@/components/projects/projects-board-view";
import type { ProjectColumn } from "@/components/projects/projects-workspace-context";
import { useProjectsWorkspace, type ProjectSort } from "@/components/projects/projects-workspace-context";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

export function ProjectsBoard() {
  const {
    activeProjects,
    projectColumns,
    renderProjectTitle,
    moveProject,
    toggleArchive,
    openCreateDialog,
    setStatus,
    domainAllowed,
    getProjectClientLabel,
    filterClientId,
    setFilterClientId,
    activeSearch,
    setActiveSearch,
    projectSort,
    setProjectSort,
    refreshProjects
  } = useProjectsWorkspace();

  const [searchValue, setSearchValue] = useState(activeSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(activeSearch);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasMountedQueryEffectRef = useRef(false);

  const trimmedSearchValue = debouncedSearch.trim();
  const effectiveSearch = trimmedSearchValue.length >= 2 ? trimmedSearchValue : "";

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

  const derivedClientOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const project of activeProjects) {
      const cid = project.client_id?.trim();
      if (!cid) continue;
      if (!byId.has(cid)) {
        byId.set(cid, { id: cid, label: getProjectClientLabel(project) });
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [activeProjects, getProjectClientLabel]);

  const derivedClientIds = useMemo(() => new Set(derivedClientOptions.map((o) => o.id)), [derivedClientOptions]);

  const clientFilterDisabled = Boolean(filterClientId && !derivedClientIds.has(filterClientId));

  const visibleClients = new Set(activeProjects.map((project) => getProjectClientLabel(project))).size;

  function handleCommandRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setSearchValue("");
      searchInputRef.current?.blur();
    }
  }

  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ProjectColumn | null>(null);
  const [justMovedProjectId, setJustMovedProjectId] = useState<string | null>(null);
  const [justUpdatedColumn, setJustUpdatedColumn] = useState<ProjectColumn | null>(null);
  const moveFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
    };
  }, []);

  async function handleMove(projectId: string, column: ProjectColumn) {
    try {
      await moveProject(projectId, column);
      setJustMovedProjectId(projectId);
      setJustUpdatedColumn(column);
      if (moveFlashTimeoutRef.current) {
        clearTimeout(moveFlashTimeoutRef.current);
      }
      moveFlashTimeoutRef.current = setTimeout(() => {
        setJustMovedProjectId(null);
        setJustUpdatedColumn(null);
      }, 900);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to move project");
    }
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
    void handleMove(draggedProjectId, column);
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

  const workbench =
    domainAllowed ? (
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
                <option value="created">Default (newest first)</option>
                <option value="title">Title A–Z</option>
                <option value="deadline">Deadline soonest</option>
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
            {activeProjects.length} showing across {visibleClients} clients
          </p>
        </div>
      </section>
    ) : null;

  const viewport = domainAllowed ? (
    <ProjectsBoardView
      items={activeProjects}
      projectColumns={projectColumns}
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
      onArchiveProject={(project) =>
        toggleArchive(project).catch((error) => setStatus(error instanceof Error ? error.message : "Archive failed"))
      }
      onOpenCreateDialog={openCreateDialog}
    />
  ) : null;

  return <ProjectsWorkspaceShell workbench={workbench} viewport={viewport} />;
}
