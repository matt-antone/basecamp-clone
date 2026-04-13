/** Pure helpers for filtering and partitioning {@link ClientRecord} arrays by archive state. No React or framework dependencies. */
import type { ClientRecord } from "@/lib/types/client-record";

export type ClientArchiveFilter = "active" | "archived";

export function isClientArchived(client: ClientRecord): boolean {
  return Boolean(client.archived_at);
}

export function filterClientsByArchiveState(
  clients: readonly ClientRecord[],
  filter: ClientArchiveFilter
): ClientRecord[] {
  const wantsArchived = filter === "archived";
  return clients.filter((client) => isClientArchived(client) === wantsArchived);
}

export function partitionClientsByArchiveState(
  clients: readonly ClientRecord[]
): { active: ClientRecord[]; archived: ClientRecord[] } {
  const active: ClientRecord[] = [];
  const archived: ClientRecord[] = [];
  for (const client of clients) {
    if (isClientArchived(client)) {
      archived.push(client);
    } else {
      active.push(client);
    }
  }
  return { active, archived };
}
