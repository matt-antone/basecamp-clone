/** Row from `clients` (JSON uses PostgreSQL column names). Archive fields optional for older API consumers. */
export type ClientRecord = {
  id: string;
  name: string;
  code: string;
  github_repos: string[];
  domains: string[];
  created_at: string;
  archived_at?: string | null;
  dropbox_archive_status?: string;
  archive_started_at?: string | null;
  archive_error?: string | null;
};
