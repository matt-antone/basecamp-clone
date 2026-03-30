"use client";

import Link from "next/link";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectTagList } from "@/components/project-tag-list";
import { normalizeProjectColumn } from "@/lib/project-utils";

export type ArchiveProjectItem = {
  id: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  tags?: string[] | null;
  status?: string | null;
  client_name?: string | null;
  client_code?: string | null;
};

type Props = {
  project: ArchiveProjectItem;
  onRestore: (project: ArchiveProjectItem) => void;
};

export function ArchiveProjectRow({ project, onRestore }: Props) {
  const column = normalizeProjectColumn(project);
  const clientLabel = project.client_name?.trim() || project.client_code?.trim() || null;
  const title = project.display_name ?? project.name;

  return (
    <li className="archiveProjectRow">
      <div className={`archiveProjectStatus tone-${column}`} aria-label={column.replace("_", " ")} />
      <div className="archiveProjectBody">
        <div className="archiveProjectMeta">
          {clientLabel && <span className="archiveProjectClient">{clientLabel}</span>}
        </div>
        <h3 className="archiveProjectTitle">
          <Link href={`/${project.id}`} className="archiveProjectLink">
            {title}
          </Link>
        </h3>
        {project.description && (
          <p className="archiveProjectDescription">{project.description}</p>
        )}
        {project.tags && project.tags.length > 0 && (
          <ProjectTagList tags={project.tags} />
        )}
      </div>
      <div className="archiveProjectActions">
        <OneShotButton
          type="button"
          className="archiveRestoreButton"
          onClick={() => onRestore(project)}
        >
          Restore
        </OneShotButton>
      </div>
    </li>
  );
}
