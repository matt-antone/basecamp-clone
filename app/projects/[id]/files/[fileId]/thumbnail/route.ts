import { requireUser } from "@/lib/auth";
import { notFound, serverError, unauthorized } from "@/lib/http";
import { getFileById } from "@/lib/repositories";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";
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
    const thumbnail = await adapter.createThumbnail(file.dropbox_path, size as "w64h64" | "w128h128" | "w256h256" | "w480h320" | "w640h480");

    if (!thumbnail) {
      return notFound("Thumbnail unavailable");
    }

    return new NextResponse(new Uint8Array(thumbnail.bytes), {
      status: 200,
      headers: {
        "Content-Type": thumbnail.contentType,
        "Cache-Control": "private, max-age=600"
      }
    });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError(error instanceof Error ? error.message : "Unable to generate thumbnail");
  }
}
