/** Allowed `projects.status` values (matches DB CHECK). */
const PROJECT_STATUSES = ["new", "in_progress", "blocked", "complete", "billing"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Non-readonly tuple for Zod `z.enum`. */
export const PROJECT_STATUSES_ZOD = PROJECT_STATUSES as unknown as [ProjectStatus, ...ProjectStatus[]];

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}
