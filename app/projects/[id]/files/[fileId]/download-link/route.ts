import { requireUser } from "@/lib/auth";
import { notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getFileById } from "@/lib/repositories";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

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

    const adapter = new DropboxStorageAdapter();
    const url = await adapter.createTemporaryDownloadLink(file.dropbox_path);
    return ok({ url, expiresInSeconds: 14400 });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
