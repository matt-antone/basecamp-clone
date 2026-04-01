export type ProjectDialogSeed = {
  name?: string | null;
  description?: string | null;
  deadline?: string | null;
  requestor?: string | null;
  tags?: string[] | null;
  pm_note?: string | null;
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
    clientId,
    pm_note: project?.pm_note ?? ""
  };
}

/** Formats a project `created_at` instant for list/board using the runtime locale and local calendar date. */
export function formatProjectCreatedAtLocal(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Formats a project `deadline` for list/board. Date-only `YYYY-MM-DD` is interpreted as a local calendar
 * day (avoids UTC midnight shifting the displayed date).
 */
export function formatProjectDeadlineLocal(deadline: string | null | undefined): string | null {
  if (!deadline?.trim()) return null;
  const s = deadline.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]) - 1;
    const d = Number(dateOnly[3]);
    const local = new Date(y, m, d);
    if (local.getFullYear() !== y || local.getMonth() !== m || local.getDate() !== d) return null;
    return local.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
