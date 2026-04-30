export type ProjectPageDirtyState = {
  projectFormDirty: boolean;
  myHoursDirty: boolean;
  archivedHoursDirty: boolean;
  expenseDraftsDirty: boolean;
  newExpenseDirty: boolean;
  fileQueued: boolean;
  createDiscussionDirty: boolean;
  mutationInFlight: boolean;
};

export function isNewerProjectUpdate(nextUpdatedDate: string | null | undefined, currentUpdatedDate: string | null | undefined) {
  if (!nextUpdatedDate || !currentUpdatedDate) return Boolean(nextUpdatedDate);
  return new Date(nextUpdatedDate).getTime() > new Date(currentUpdatedDate).getTime();
}

export function collectNewIds<T extends { id: string }>(items: T[], seenIds: ReadonlySet<string>) {
  return new Set(items.map((item) => item.id).filter((id) => !seenIds.has(id)));
}

export function hasDirtyProjectPageDrafts(state: ProjectPageDirtyState) {
  return Object.values(state).some(Boolean);
}
