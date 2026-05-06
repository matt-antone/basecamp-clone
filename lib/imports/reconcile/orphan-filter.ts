// lib/imports/reconcile/orphan-filter.ts

export function applyOrphanFilter<T extends { created_at: Date }>(
  items: T[],
  project: { created_at: Date },
): { kept: T[]; dropped: T[] } {
  const cutoff = project.created_at.getTime();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (item.created_at.getTime() < cutoff) dropped.push(item);
    else kept.push(item);
  }
  return { kept, dropped };
}
