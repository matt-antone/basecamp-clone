// lib/imports/migration/types.ts

type Phase = "people" | "projects" | "threads" | "files" | "all";
export type ProjectFilter = "active" | "archived" | "all";

export interface CliFlags {
  phase: Phase;
  projects: ProjectFilter;
  limit: number | null;
  projectId: number | null;
  dumpDir: string;
  dryRun: boolean;
  noFiles: boolean;
}

export interface MigratedProject {
  bc2Id: number;
  localId: string;
  name: string;
}
