import { ProjectsBilling } from "@/components/projects/projects-billing";
import { ProjectsWorkspaceProvider } from "@/components/projects/projects-workspace-context";

export default function BillingPage() {
  return (
    <ProjectsWorkspaceProvider>
      <ProjectsBilling />
    </ProjectsWorkspaceProvider>
  );
}
