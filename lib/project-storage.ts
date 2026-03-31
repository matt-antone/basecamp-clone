import slugify from "slugify";
import { config } from "./config";

const ARCHIVE_DIR_NAME = "_Archive";

type ProjectRecord = Record<string, unknown>;

/** Strip trailing -#### sequence number from `project_code` to get the client code (e.g. BRGS-0007 → BRGS). */
export function clientCodeFromProjectCode(projectCode: string): string {
  return projectCode.replace(/-[0-9]{4}$/, "");
}

function clientCodeUpperFromProject(project: ProjectRecord): string {
  const raw =
    (typeof project.client_code === "string" && project.client_code.trim()) ||
    clientCodeFromProjectCode(String(project.project_code ?? ""));
  return raw.toUpperCase();
}

/** Remove characters unsafe in Dropbox / cross-platform paths; normalize whitespace. */
export function sanitizeDropboxFolderTitle(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "project";
}

function folderTitleFromProject(project: ProjectRecord): string {
  const fromName = typeof project.name === "string" ? project.name.trim() : "";
  if (fromName) {
    return sanitizeDropboxFolderTitle(fromName);
  }
  const slug =
    (typeof project.project_slug === "string" && project.project_slug) ||
    (typeof project.slug === "string" && project.slug) ||
    "";
  if (slug) {
    return sanitizeDropboxFolderTitle(slug.replace(/-/g, " "));
  }
  return "project";
}

/**
 * Dropbox folder basename.
 * When `project_code` ends with `-####`: `<PROJECT_CODE>-<display title>` (e.g. `ALG-0005-Website Updates`).
 * Otherwise legacy: `<CLIENTCODE>-<client-slug>-<project-slug>`.
 */
export function buildDropboxProjectFolderBaseName(project: ProjectRecord): string {
  const fullCode = String(project.project_code ?? "").trim();
  if (fullCode && /-[0-9]{4}$/.test(fullCode)) {
    return `${fullCode.toUpperCase()}-${folderTitleFromProject(project)}`;
  }

  const clientPart =
    (typeof project.client_slug === "string" && project.client_slug) ||
    (typeof project.client_name === "string" && slugify(project.client_name, { strict: true })) ||
    "unassigned";
  const slugPart =
    (typeof project.project_slug === "string" && project.project_slug) ||
    (typeof project.slug === "string" && project.slug) ||
    "project";
  const prefix = clientCodeUpperFromProject(project);
  return `${prefix}-${clientPart}-${slugPart}`;
}

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
  const storageDir = typeof project.storage_project_dir === "string" ? project.storage_project_dir.trim() : "";
  if (storageDir) {
    const parts = storageDir.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 2] === ARCHIVE_DIR_NAME) {
      return `/${parts.slice(0, -2).join("/")}`;
    }
    if (parts.length >= 2) {
      return `/${parts.slice(0, -1).join("/")}`;
    }
    return storageDir.startsWith("/") ? storageDir : `/${storageDir}`;
  }
  const clientCodeUpper = clientCodeUpperFromProject(project);
  return `${config.dropboxProjectsRootFolder()}/${clientCodeUpper}`;
}

function getProjectFolderName(project: ProjectRecord) {
  const storageDir = typeof project.storage_project_dir === "string" ? project.storage_project_dir.trim() : "";
  const existingFolderName = storageDir.split("/").filter(Boolean).at(-1);
  if (existingFolderName && existingFolderName !== ARCHIVE_DIR_NAME) {
    return existingFolderName;
  }

  return buildDropboxProjectFolderBaseName(project);
}
