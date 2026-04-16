export type ArchiveProjectsUrlOptions = {
  search: string;
  page: number;
  clientId: string | null;
  limit?: number;
};

/** Build the query URL for `GET /projects/archived`. `clientId` is omitted when falsy. */
export function buildArchiveProjectsUrl({
  search,
  page,
  clientId,
  limit = 20
}: ArchiveProjectsUrlOptions): string {
  const params = new URLSearchParams({
    search,
    page: String(page),
    limit: String(limit)
  });
  if (clientId) {
    params.set("clientId", clientId);
  }
  return `/projects/archived?${params.toString()}`;
}
