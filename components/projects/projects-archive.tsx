"use client";

import { ArchiveTab } from "@/components/projects/archive-tab";
import type { ArchiveProjectItem } from "@/components/projects/archive-project-row";
import type { Project } from "@/components/projects/projects-workspace-context";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";

export function ProjectsArchive() {
  const { accessToken, setAccessToken, toggleArchive, openCreateDialog, domainAllowed } = useProjectsWorkspace();

  const viewport = domainAllowed ? (
    <ArchiveTab
      accessToken={accessToken}
      onToken={setAccessToken}
      onOpenCreateDialog={openCreateDialog}
      onRestore={async (project: ArchiveProjectItem) => {
        await toggleArchive({ ...project, archived: true } as Project);
      }}
    />
  ) : null;

  return <ProjectsWorkspaceShell showHero={false} viewport={viewport} />;
}
