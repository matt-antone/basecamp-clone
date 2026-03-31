import { ProjectsBoard } from "@/components/projects/projects-board";
import { ProjectsWorkspaceProvider } from "@/components/projects/projects-workspace-context";

export default function FlowPage() {
  return (
    <ProjectsWorkspaceProvider>
      <ProjectsBoard />
    </ProjectsWorkspaceProvider>
  );
}
