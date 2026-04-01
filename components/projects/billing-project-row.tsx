"use client";

import Link from "next/link";
import { OneShotButton } from "@/components/one-shot-button";
import { ProjectTagList } from "@/components/project-tag-list";
import { normalizeProjectColumn } from "@/lib/project-utils";

export type BillingProjectItem = {
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
  project: BillingProjectItem;
  onArchive: (project: BillingProjectItem) => void;
  onReopen: (project: BillingProjectItem) => void;
};

export function BillingProjectRow({ project, onArchive, onReopen }: Props) {
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
        {project.description && <p className="archiveProjectDescription">{project.description}</p>}
        {project.tags && project.tags.length > 0 && <ProjectTagList tags={project.tags} />}
      </div>
      <div className="archiveProjectActions projectFlowCardActions">
        <OneShotButton type="button" className="archiveRestoreButton" onClick={() => onArchive(project)}>
          Archive
        </OneShotButton>
        <OneShotButton type="button" className="archiveRestoreButton" onClick={() => onReopen(project)}>
          Reopen work
        </OneShotButton>
      </div>
    </li>
  );
}
