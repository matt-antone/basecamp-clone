import React from "react";
import Link from "next/link";
import { type CSSProperties, type DragEvent, type ReactNode } from "react";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectTagList } from "@/components/project-tag-list";
import { formatProjectCreatedAtLocal, formatProjectDeadlineLocal, normalizeProjectColumn } from "@/lib/project-utils";

type ProjectColumn = "new" | "in_progress" | "blocked" | "complete";

type ProjectColumnDefinition = {
  key: ProjectColumn;
  title: string;
  subtitle: string;
};

type ProjectBoardItem = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  tags?: string[] | null;
  client_id: string | null;
  client_name?: string | null;
  client_code?: string | null;
  status?: string | null;
  archived: boolean;
  created_at?: string | null;
  deadline?: string | null;
  pm_note?: string | null;
};

export type ProjectsBoardViewProps = {
  items: ProjectBoardItem[];
  projectColumns: ProjectColumnDefinition[];
  dragOverColumn: ProjectColumn | null;
  draggingProjectId: string | null;
  justMovedProjectId: string | null;
  justUpdatedColumn: ProjectColumn | null;
  renderProjectTitle: (title: string) => ReactNode;
  onColumnDragOver: (event: DragEvent<HTMLElement>, column: ProjectColumn) => void;
  onColumnDragLeave: (column: ProjectColumn) => void;
  onColumnDrop: (event: DragEvent<HTMLElement>, column: ProjectColumn) => void;
  onCardDragStart: (event: DragEvent<HTMLLIElement>, projectId: string) => void;
  onCardDragEnd: () => void;
  onArchiveProject: (project: ProjectBoardItem) => void;
  onOpenCreateDialog: () => void;
};

export function ProjectsBoardView(props: ProjectsBoardViewProps) {
  const {
    items,
    projectColumns,
    dragOverColumn,
    draggingProjectId,
    justMovedProjectId,
    justUpdatedColumn,
    renderProjectTitle,
    onColumnDragOver,
    onColumnDragLeave,
    onColumnDrop,
    onCardDragStart,
    onCardDragEnd,
    onArchiveProject,
    onOpenCreateDialog
  } = props;

  return (
    <>
      <div className="projectsHeader">
        <h1>Project Board</h1>
        <OneShotButton type="button" className="projectPrimaryButton" onClick={onOpenCreateDialog}>
          New project
        </OneShotButton>
      </div>
      <div className="projectFlowGrid">
        {projectColumns.map((column) => {
          const columnProjects = items
            .filter((project) => normalizeProjectColumn(project) === column.key)
            .sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name));
          return (
            <section
              key={column.key}
              className={`projectFlowColumn tone-${column.key} ${dragOverColumn === column.key ? "projectFlowColumnDropTarget" : ""}`}
              onDragOver={(event) => onColumnDragOver(event, column.key)}
              onDragLeave={() => onColumnDragLeave(column.key)}
              onDrop={(event) => onColumnDrop(event, column.key)}
            >
              <header className="projectFlowColumnHeader">
                <div>
                  <p className="projectFlowEyebrow">{column.subtitle}</p>
                  <h2>{column.title}</h2>
                </div>
                <span
                  key={`${column.key}-${columnProjects.length}`}
                  className={justUpdatedColumn === column.key ? "projectFlowCountFlash" : ""}
                >
                  {columnProjects.length}
                </span>
              </header>

              <ul className="projectFlowList">
                {columnProjects.map((project) => {
                  const createdLabel = formatProjectCreatedAtLocal(project.created_at);
                  const createdRaw = project.created_at?.trim();
                  const deadlineLabel = formatProjectDeadlineLocal(project.deadline);
                  const deadlineRaw = project.deadline?.trim();
                  return (
                  <li
                    key={project.id}
                    className={`projectFlowCard ${draggingProjectId === project.id ? "projectFlowCardDragging" : ""} ${justMovedProjectId === project.id ? "projectFlowCardSettled" : ""}`}
                    style={{ viewTransitionName: `project-${project.id}` } as CSSProperties}
                    draggable
                    onDragStart={(event) => onCardDragStart(event, project.id)}
                    onDragEnd={onCardDragEnd}
                  >
                    <div className="projectMain projectFlowCardBody">
                      <div className="projectTitleRow">
                        <Link
                          href={`/${project.id}`}
                          className={`projectLink projectTitle projectFlowCardTitle tone-${normalizeProjectColumn(project)}`}
                        >
                          {renderProjectTitle(project.display_name ?? project.name)}
                        </Link>
                        {createdLabel && createdRaw ? (
                          <time className="projectCreatedMeta" dateTime={createdRaw}>
                            · {createdLabel}
                          </time>
                        ) : null}
                        {deadlineLabel && deadlineRaw ? (
                          <time className="projectDeadlineMeta" dateTime={deadlineRaw}>
                            · Due {deadlineLabel}
                          </time>
                        ) : null}
                      </div>
                      {project.pm_note?.trim() ? (
                        <p className="projectPmNote" title={project.pm_note.trim()}>
                          {project.pm_note.trim()}
                        </p>
                      ) : null}
                      <p className="projectDescription projectFlowCardDescription line-clamp-2">
                        {project.description?.trim() || "No description provided."}
                      </p>
                      <ProjectTagList tags={project.tags} className="projectTagListCompact" />
                    </div>
                    <div className="projectFlowCardFoot">
                      <div className="projectFlowCardActions">
                        {column.title === "Complete" && <OneShotButton
                          type="button"
                          className="projectActionButton"
                          onClick={() => onArchiveProject(project)}
                        >
                          Archive
                        </OneShotButton>}
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

    </>

  );
}
