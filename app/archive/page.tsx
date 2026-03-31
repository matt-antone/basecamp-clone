import { ProjectsArchive } from "@/components/projects/projects-archive";
import { ProjectsWorkspaceProvider } from "@/components/projects/projects-workspace-context";

export default function ArchivePage() {
  return (
    <ProjectsWorkspaceProvider>
      <ProjectsArchive />
    </ProjectsWorkspaceProvider>
  );
}
