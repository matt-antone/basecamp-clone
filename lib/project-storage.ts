import slugify from "slugify";
import { config } from "./config";

const ARCHIVE_DIR_NAME = "_Archive";

type ProjectRecord = Record<string, unknown>;

export function getProjectStorageDir(project: ProjectRecord) {
  if (typeof project.storage_project_dir === "string" && project.storage_project_dir) {
    return project.storage_project_dir;
  }

  return getProjectStorageDirForArchiveState(project, Boolean(project.archived));
}

export function getProjectStorageDirForArchiveState(project: ProjectRecord, archived: boolean) {
  const folderName = getProjectFolderName(project);
  const clientDir = getClientDir(project);
  return archived ? `${clientDir}/${ARCHIVE_DIR_NAME}/${folderName}` : `${clientDir}/${folderName}`;
}

function getClientDir(project: ProjectRecord) {
  const clientSlug =
    (typeof project.client_slug === "string" && project.client_slug) ||
    (typeof project.client_name === "string" && slugify(project.client_name, { strict: true })) ||
    "unassigned";
  return `${config.dropboxProjectsRootFolder()}/${clientSlug}`;
}

function getProjectFolderName(project: ProjectRecord) {
  const storageDir = typeof project.storage_project_dir === "string" ? project.storage_project_dir.trim() : "";
  const existingFolderName = storageDir.split("/").filter(Boolean).at(-1);
  if (existingFolderName) {
    return existingFolderName;
  }

  const projectSlug =
    (typeof project.project_slug === "string" && project.project_slug) ||
    (typeof project.slug === "string" && project.slug) ||
    "project";
  const projectCode =
    (typeof project.project_code === "string" && project.project_code) ||
    (typeof project.id === "string" ? project.id : "project");

  return `${projectCode}-${projectSlug}`;
}
