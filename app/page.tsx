import { ProjectsList } from "@/components/projects/projects-list";
import { ProjectsWorkspaceProvider } from "@/components/projects/projects-workspace-context";

export default function Page() {
  return (
    <ProjectsWorkspaceProvider>
      <ProjectsList />
    </ProjectsWorkspaceProvider>
  );
}
