import { requireUser } from "@/lib/auth";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getFileById } from "@/lib/repositories";
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
    const file = await getFileById(id, fileId);
    if (!file) {
      return notFound("File not found");
    }

    if (typeof file.mime_type !== "string" || !file.mime_type.toLowerCase().startsWith("image/")) {
      return notFound("Thumbnail not available for this file type");
    }

    const url = new URL(request.url);
    const requestedSize = url.searchParams.get("size") ?? "w256h256";
    const size = allowedSizes.has(requestedSize) ? requestedSize : "w256h256";
    const adapter = new DropboxStorageAdapter();
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
