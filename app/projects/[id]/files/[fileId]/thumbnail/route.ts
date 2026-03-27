import { requireUser } from "@/lib/auth";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getFileById, getProject } from "@/lib/repositories";
import { getProjectStorageDir } from "@/lib/project-storage";
import { ensureImportedFileThumbnail, isSupportedImportThumbnailSource } from "@/lib/import-thumbnail";
import {
  DropboxStorageAdapter,
  getDropboxErrorSummary,
  isTeamSelectUserRequiredError
} from "@/lib/storage/dropbox-adapter";
import { NextResponse } from "next/server";

const allowedSizes = new Set(["w64h64", "w128h128", "w256h256", "w480h320", "w640h480"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    await requireUser(request);
    const { id, fileId } = await params;
    const [project, file] = await Promise.all([getProject(id), getFileById(id, fileId)]);
    if (!project) {
      return notFound("Project not found");
    }
    if (!file) {
      return notFound("File not found");
    }

    const adapter = new DropboxStorageAdapter();
    const projectStorageDir = getProjectStorageDir(project);
    const savedThumbnailPath = `${projectStorageDir}/uploads/.thumbnails/${file.id}.jpg`;
    const savedThumbnail = await downloadSavedThumbnail(adapter, savedThumbnailPath);
    if (savedThumbnail) {
      return imageResponse(savedThumbnail.bytes, savedThumbnail.contentType);
    }

    const generatedSavedThumbnail = await generateSavedThumbnailOnDemand({
      adapter,
      file,
      projectStorageDir,
      savedThumbnailPath
    });
    if (generatedSavedThumbnail) {
      return imageResponse(generatedSavedThumbnail.bytes, generatedSavedThumbnail.contentType);
    }

    if (typeof file.mime_type !== "string" || !file.mime_type.toLowerCase().startsWith("image/")) {
      return notFound("Thumbnail not available for this file type");
    }

    const url = new URL(request.url);
    const requestedSize = url.searchParams.get("size") ?? "w256h256";
    const size = allowedSizes.has(requestedSize) ? requestedSize : "w256h256";
    const dropboxTargets = getDropboxTargets(file);
    let lastError: unknown = null;

    for (const target of dropboxTargets) {
      try {
        const thumbnail = await adapter.createThumbnail(
          target,
          size as "w64h64" | "w128h128" | "w256h256" | "w480h320" | "w640h480"
        );

        if (thumbnail) {
          return new NextResponse(new Uint8Array(thumbnail.bytes), {
            status: 200,
            headers: {
              "Content-Type": thumbnail.contentType,
              "Cache-Control": "private, max-age=600"
            }
          });
        }
      } catch (error) {
        if (shouldRethrowThumbnailError(error)) {
          throw error;
        }
        lastError = error;
      }

      try {
        const fallback = await adapter.downloadFile(target);
        return new NextResponse(new Uint8Array(fallback.bytes), {
          status: 200,
          headers: {
            "Content-Type": fallback.contentType,
            "Cache-Control": "private, max-age=600"
          }
        });
      } catch (error) {
        if (shouldRethrowThumbnailError(error)) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError ?? new Error("Unable to generate thumbnail");
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (isTeamSelectUserRequiredError(error)) {
      return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
    }
    return serverError(error instanceof Error ? error.message : "Unable to generate thumbnail");
  }
}

async function downloadSavedThumbnail(adapter: DropboxStorageAdapter, path: string) {
  try {
    return await adapter.downloadFile(path);
  } catch (error) {
    if (shouldRethrowThumbnailError(error)) {
      throw error;
    }
    if (isMissingThumbnailError(error)) {
      return null;
    }
    throw error;
  }
}

function getDropboxTargets(file: Record<string, unknown>) {
  const targets = [
    typeof file.dropbox_file_id === "string" ? file.dropbox_file_id.trim() : "",
    typeof file.dropbox_path === "string" ? file.dropbox_path.trim() : ""
  ].filter(Boolean);

  return [...new Set(targets)];
}

function shouldRethrowThumbnailError(error: unknown) {
  if (isTeamSelectUserRequiredError(error)) {
    return true;
  }

  const summary = getDropboxErrorSummary(error);
  return /auth|token|workspace/i.test(summary);
}

function isMissingThumbnailError(error: unknown) {
  const summary = getDropboxErrorSummary(error);
  return /not[_-]?found|path\/not_found|path not found/i.test(summary);
}

function imageResponse(bytes: Buffer, contentType: string) {
  const normalizedContentType = contentType.toLowerCase().startsWith("image/") ? contentType : "image/jpeg";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": normalizedContentType,
      "Cache-Control": "private, max-age=600"
    }
  });
}

function getNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function generateSavedThumbnailOnDemand({
  adapter,
  file,
  projectStorageDir,
  savedThumbnailPath
}: {
  adapter: DropboxStorageAdapter;
  file: Record<string, unknown>;
  projectStorageDir: string;
  savedThumbnailPath: string;
}) {
  const filename = getNonEmptyString(file.name);
  const mimeType = getNonEmptyString(file.mime_type);
  const dropboxPath = getNonEmptyString(file.dropbox_path);
  const projectFileId = getNonEmptyString(file.id);

  if (!filename || !mimeType || !dropboxPath || !projectFileId) {
    return null;
  }
  if (!isSupportedImportThumbnailSource({ filename, mimeType })) {
    return null;
  }

  try {
    const thumbnailRequest = {
      projectStorageDir,
      projectFileId,
      filename,
      mimeType,
      dropboxPath
    };

    const workerResult = await ensureImportedFileThumbnail(thumbnailRequest);
    if (workerResult.action !== "generated" && workerResult.action !== "reused") {
      return null;
    }
    return await downloadSavedThumbnail(adapter, savedThumbnailPath);
  } catch (error) {
    console.warn("on_demand_thumbnail_generation_failed", {
      fileId: projectFileId,
      dropboxPath,
      error: error instanceof Error ? error.message : String(error)
    });

    try {
      const localResult = await ensureImportedFileThumbnail(
        {
          projectStorageDir,
          projectFileId,
          filename,
          mimeType,
          dropboxPath
        },
        {
          // Explicitly disable worker to allow local generation fallback in this request path.
          workerUrl: ""
        }
      );
      if (localResult.action !== "generated" && localResult.action !== "reused") {
        return null;
      }
      return await downloadSavedThumbnail(adapter, savedThumbnailPath);
    } catch (fallbackError) {
      console.warn("on_demand_thumbnail_generation_fallback_failed", {
        fileId: projectFileId,
        dropboxPath,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      });
      return null;
    }
  }
}
