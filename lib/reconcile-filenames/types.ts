export type PlanRow = {
  fileId: string;
  projectId: string;
  dropboxFileId: string | null;
  fromPath: string;
  toPath: string;
};

export type OrphanRow = {
  projectId: string;
  path: string;
  basename: string;
};

export type ErrorRow = {
  projectId: string;
  error: string;
};

type ProgressRow = {
  dropbox_done: boolean;
  db_done: boolean;
  newPath?: string;
  error?: string;
};

export type ProgressFile = Record<string, ProgressRow>;
