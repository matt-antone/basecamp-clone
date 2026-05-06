// lib/imports/reconcile/types.ts

export interface CliFlags {
  projectId: number | null;     // bc2_id, not local id
  limit: number | null;
  dryRun: boolean;
  outDir: string;
}

export interface ProdProject {
  id: number;
  bc2_id: number;
  title: string;
  client_id: number;
  client_code: string;
  slug: string;
  description: string | null;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TestProject {
  id: number;
  bc2_id: number;
  client_id: number;
  created_at: Date;
}

export interface FileRow {
  id: number;
  project_id: number;
  uploader_id: number;
  filename: string;
  size: number;
  mime_type: string | null;
  dropbox_path: string | null;
  created_at: Date;
}

export interface DiscussionRow {
  id: number;
  project_id: number;
  author_id: number;
  title: string;
  body: string | null;
  created_at: Date;
}

export interface CommentRow {
  id: number;
  thread_id: number;
  author_id: number;
  body: string | null;
  created_at: Date;
}

export interface ReconcileSummary {
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  prodActiveTotal: number;
  unmappedProjects: number;
  unresolvedClient: number;
  syncedProjects: number;
  newTestProjects: number;
  files:       { inserted: number; duplicate: number; orphan: number };
  discussions: { inserted: number; duplicate: number; orphan: number };
  comments:    { inserted: number; duplicate: number; orphan: number };
  peopleSkips: number;
  walltimeMs: number;
}
