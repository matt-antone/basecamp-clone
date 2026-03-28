import { requireUser } from "@/lib/auth";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getFileById, getProject } from "@/lib/repositories";
import { NextResponse } from "next/server";

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

    const thumbnailUrl = getNonEmptyString((file as Record<string, unknown>).thumbnail_url);
    if (thumbnailUrl) {
      return NextResponse.redirect(thumbnailUrl, 307);
    }

    return notFound("Thumbnail not available");
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError(error instanceof Error ? error.message : "Unable to load thumbnail");
  }
}

function getNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
