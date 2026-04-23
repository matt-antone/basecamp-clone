import type { ProjectStatus } from "./project-status";

export type ProjectDialogSeed = {
  name?: string | null;
  description?: string | null;
  deadline?: string | null;
  requestor?: string | null;
  tags?: string[] | null;
  pm_note?: string | null;
};

/** Kanban / workspace columns (`billing` uses `/billing`, not the board). */
export type ProjectColumn = Exclude<ProjectStatus, "billing">;

export function normalizeProjectColumn(projectRecord: { status?: string | null } | null | undefined): ProjectColumn {
  const value = (projectRecord?.status ?? "new").toLowerCase();
  if (value === "billing") return "complete";
  if (value === "in_progress" || value === "in progress") return "in_progress";
  if (value === "blocked") return "blocked";
  if (value === "complete" || value === "completed") return "complete";
  return "new";
}

function coerceHoursTotal(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A project is "missing hours" when it has reached billing/complete state
 * but no hours have been logged yet. Used to flag jobs waiting on billing
 * or marked complete without any recorded effort.
 */
export function hasMissingHours(
  projectRecord: { status?: string | null; total_hours?: number | string | null } | null | undefined
): boolean {
  const status = (projectRecord?.status ?? "").toLowerCase();
  const eligible = status === "billing" || status === "complete" || status === "completed";
  if (!eligible) return false;
  return coerceHoursTotal(projectRecord?.total_hours) <= 0;
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

function toDateInputValue(deadline: string | null | undefined): string {
  if (!deadline) return "";
  const s = String(deadline).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoMatch = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
  if (isoMatch) return isoMatch[1];
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export function createProjectDialogValues(clientId = "", project?: ProjectDialogSeed | null) {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    deadline: toDateInputValue(project?.deadline),
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
