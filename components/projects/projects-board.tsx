"use client";

import { ProjectsBoardView } from "@/components/projects/projects-board-view";
import { ProjectsFilterShelf } from "@/components/projects/projects-filter-shelf";
import { useProjectsFilterShelf } from "@/components/projects/use-projects-filter-shelf";
import type { ProjectColumn } from "@/components/projects/projects-workspace-context";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import { type DragEvent, useEffect, useRef, useState } from "react";

export function ProjectsBoard() {
  const {
    activeProjects,
    projectColumns,
    renderProjectTitle,
    authedFetch,
    moveProject,
    toggleArchive,
    openCreateDialog,
    setStatus,
    domainAllowed,
    getProjectClientLabel,
    filterClientId,
    activeSearch,
    projectSort,
    refreshProjects
  } = useProjectsWorkspace();

  const filterShelf = useProjectsFilterShelf(activeProjects);

  const visibleClients = new Set(activeProjects.map((project) => getProjectClientLabel(project))).size;

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

  async function handleSendToBilling(projectId: string) {
    await authedFetch(`/projects/${projectId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "billing" })
    });
    await refreshProjects({ clientId: filterClientId, search: activeSearch, sort: projectSort });
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

  const workbench = domainAllowed ? (
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
      resultCount={activeProjects.length}
      clientCount={visibleClients}
    />
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
      onSendToBilling={(project) =>
        handleSendToBilling(project.id).catch((error) =>
          setStatus(error instanceof Error ? error.message : "Failed to send project to billing")
        )
      }
      onArchiveProject={(project) =>
        toggleArchive(project).catch((error) => setStatus(error instanceof Error ? error.message : "Archive failed"))
      }
      onOpenCreateDialog={openCreateDialog}
    />
  ) : null;

  return <ProjectsWorkspaceShell showHero={false} workbench={workbench} viewport={viewport} />;
}
