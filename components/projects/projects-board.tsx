"use client";

import { ProjectsBoardView } from "@/components/projects/projects-board-view";
import type { ProjectColumn } from "@/components/projects/projects-workspace-context";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";
import { type DragEvent, useEffect, useRef, useState } from "react";

export function ProjectsBoard() {
  const {
    activeProjects,
    projectColumns,
    renderProjectTitle,
    moveProject,
    toggleArchive,
    setStatus,
    domainAllowed
  } = useProjectsWorkspace();

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
    />
  ) : null;

  return <ProjectsWorkspaceShell viewport={viewport} />;
}
