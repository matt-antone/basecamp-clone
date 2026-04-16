import React, { useEffect } from "react";
import Link from "next/link";
import { type CSSProperties, type FocusEvent, type ReactNode } from "react";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectTagList } from "@/components/project-tag-list";
import {
  formatProjectCreatedAtLocal,
  formatProjectDeadlineLocal,
  normalizeProjectColumn,
  type ProjectColumn
} from "@/lib/project-utils";

type ProjectColumnDefinition = {
  key: ProjectColumn;
  title: string;
  subtitle: string;
};

type ProjectListItem = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  tags?: string[] | null;
  archived: boolean;
  client_id: string | null;
  client_name?: string | null;
  client_code?: string | null;
  status?: string | null;
  discussion_count?: number;
  file_count?: number;
  created_at?: string | null;
  deadline?: string | null;
  pm_note?: string | null;
};

type ProjectGroup = {
  label: string;
  projects: ProjectListItem[];
};

export type ProjectsListViewProps = {
  items: ProjectListItem[];
  projectColumns: ProjectColumnDefinition[];
  activeTab: "list" | "archived";
  hasSearchOrFilter: boolean;
  highlightedProjectId: string | null;
  emptyState: string;
  onOpenCreateDialog: () => void;
  onHighlightProject: (projectId: string) => void;
  onProjectBlur: (event: FocusEvent<HTMLLIElement>, projectId: string) => void;
  renderProjectTitle: (title: string) => ReactNode;
  getProjectStatusLabel: (project: ProjectListItem) => string;
  getProjectClientLabel: (project: ProjectListItem) => string;
};

export function ProjectsListView(props: ProjectsListViewProps) {
  const {
    items,
    projectColumns,
    activeTab,
    hasSearchOrFilter,
    highlightedProjectId,
    emptyState,
    onOpenCreateDialog,
    onHighlightProject,
    onProjectBlur,
    renderProjectTitle,
    getProjectStatusLabel,
    getProjectClientLabel
  } = props;

  const groups = groupProjectsByClient(items, getProjectClientLabel);

  const [now, setNow] = React.useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  if (groups.length === 0) {
    return (
      <section className="projectsEmptyState">
        <p className="projectsEmptyEyebrow">{activeTab === "archived" ? "Archive" : "Clear surface"}</p>
        <h2>{emptyState}</h2>
        <p>
          {hasSearchOrFilter
            ? "Try widening the search or switching back to all statuses."
            : "Create a project and the index will start forming around your client work."}
        </p>
        {!hasSearchOrFilter && activeTab !== "archived" && (
          <OneShotButton type="button" className="projectPrimaryButton" onClick={onOpenCreateDialog}>
            New project
          </OneShotButton>
        )}
      </section>
    );
  }
  const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const COMPARISON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="projectClientAtlas">
      <div className="projectsHeader">
        <h1>Project List</h1>
        <OneShotButton type="button" className="projectPrimaryButton" onClick={onOpenCreateDialog}>
          New project
        </OneShotButton>
      </div>
      {groups.map((group) => (
        <section key={group.label} className="clientLedgerSection">
          <header className="clientLedgerIntro">
            <div className="clientLedgerCopy">
              <h2>
                {group.label}
              </h2>
              <p className="clientLedgerSummary">
                {projectColumns.map((column) => {
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
          </header>
          <ul className="clientProjectLedger">
            {group.projects.map((project) => {
              const createdLabel = formatProjectCreatedAtLocal(project.created_at);
              const createdRaw = project.created_at?.trim();
              const deadlineLabel = formatProjectDeadlineLocal(project.deadline);
              const deadlineRaw = project.deadline?.trim();
              const createdTime = createdRaw ? new Date(createdRaw).getTime() : NaN;
              const deadlineTime = deadlineRaw ? new Date(deadlineRaw).getTime() : NaN;
              const showDeadlineClose =
                now != null &&
                Number.isFinite(deadlineTime) &&
                now.getTime() - deadlineTime < WARNING_WINDOW_MS;

              const showDeadlineYikes =
                now != null &&
                Number.isFinite(deadlineTime) &&
                now.getTime() - deadlineTime > 1;

              const showCreatedYikes =
                now != null &&
                Number.isFinite(createdTime) &&
                now.getTime() - createdTime > COMPARISON_WINDOW_MS;
              return (
                <li
                  key={project.id}
                  className={`projectLedgerItem tone-${normalizeProjectColumn(project)} ${highlightedProjectId === project.id ? "projectLedgerItemActive" : ""}`}
                  data-project-id={project.id}
                  style={{ viewTransitionName: `project-${project.id}` } as CSSProperties}
                  onFocusCapture={() => onHighlightProject(project.id)}
                  onBlurCapture={(event) => onProjectBlur(event, project.id)}
                >
                  <div className="projectMain projectLedgerBody">
                    <div className="projectTitleRow">
                      <Link
                        href={`/${project.id}`}
                        className={`projectLink projectTitle projectLedgerTitle tone-${normalizeProjectColumn(project)}`}
                      >
                        {renderProjectTitle(project.display_name ?? project.name)}
                      </Link>
                    </div>
                    <p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
                    {project.pm_note?.trim() ? (
                      <p className="projectPmNote" title={project.pm_note.trim()}>
                        {project.pm_note.trim()}
                      </p>
                    ) : null}
                    {/* <ProjectTagList tags={project.tags} className="projectTagListCompact" /> */}
                    <p className="projectLedgerCounts">
                      {project.discussion_count ?? 0} discussions · {project.file_count ?? 0} files
                    </p>
                  </div>
                  {/* <div className="projectLedgerActions">
                    <Link href={`/${project.id}`} className="projectActionLink">
                      Open
                    </Link>
                  </div> */}
                  <div className="projectLedgerRail">
                    <span className="projectLedgerStatus">{getProjectStatusLabel(project)}</span>
                    <div className="projectMetaRow">
                      {createdLabel && createdRaw ? (
                        <time className="projectCreatedMeta" dateTime={createdRaw}>
                          Created: {createdLabel} <span className="projectCreatedYikes">{showCreatedYikes ? `🔴` : `🟢`}</span>
                        </time>
                      ) : null}
                    </div>
                    <div className="projectMetaRow">
                      {deadlineLabel && deadlineRaw ? (
                        <time className="projectDeadlineMeta" dateTime={deadlineRaw}>
                          Due: {deadlineLabel} <span className="projectDeadlineYikes">{showDeadlineYikes ? `🔴` : showDeadlineClose ? `🟡` : `🟢`}</span>
                        </time>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupProjectsByClient(
  items: ProjectListItem[],
  getProjectClientLabel: (project: ProjectListItem) => string
): ProjectGroup[] {
  const grouped = new Map<string, ProjectGroup>();
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
      projects: group.projects.sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name))
    }));
}
