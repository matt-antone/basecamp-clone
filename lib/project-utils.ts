export type ProjectDialogSeed = {
  name?: string | null;
  description?: string | null;
  deadline?: string | null;
  requestor?: string | null;
  tags?: string[] | null;
};

export type ProjectColumn = "new" | "in_progress" | "blocked" | "complete";

export function normalizeProjectColumn(projectRecord: { status?: string | null } | null | undefined): ProjectColumn {
  const value = (projectRecord?.status ?? "new").toLowerCase();
  if (value === "in_progress" || value === "in progress") return "in_progress";
  if (value === "blocked") return "blocked";
  if (value === "complete" || value === "completed") return "complete";
  return "new";
}

export function parseProjectTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function createProjectDialogValues(clientId = "", project?: ProjectDialogSeed | null) {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    deadline: project?.deadline ?? "",
    requestor: project?.requestor ?? "",
    tags: (project?.tags ?? []).join(", "),
    clientId
  };
}
