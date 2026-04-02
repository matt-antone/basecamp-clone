import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getClientById, rewriteClientDropboxPaths, updateClientArchiveState } from "@/lib/repositories";
import { DropboxStorageAdapter, getDropboxErrorSummary } from "@/lib/storage/dropbox-adapter";

function getPollUrl(id: string) {
  return `/clients/${id}`;
}

function getConfiguredArchivedRoot() {
  try {
    return config.dropboxArchivedClientsRoot();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "DROPBOX_ARCHIVED_CLIENTS_ROOT is required to archive clients.");
  }
}

/**
 * Dropbox client-folder moves can take minutes for large trees, so this route returns `202 Accepted`
 * and completes the move in `after()`. v1 has no automatic retries; the UI surfaces failures and
 * re-invokes this route manually after the operator reviews the error.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id } = await params;
    const client = await getClientById(id);
    if (!client) {
      return notFound("Client not found");
    }

    try {
      getConfiguredArchivedRoot();
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "DROPBOX_ARCHIVED_CLIENTS_ROOT is required to archive clients.");
    }

    const status = (client.dropbox_archive_status ?? "idle").toLowerCase();
    if (status === "pending" || status === "in_progress") {
      return conflict("Client archive is already running.");
    }
    if (client.archived_at) {
      return conflict("Client is already archived.");
    }

    await updateClientArchiveState(id, {
      status: "pending",
      archiveError: null
    });

    after(async () => {
      const adapter = new DropboxStorageAdapter();
      try {
        await updateClientArchiveState(id, {
          status: "in_progress",
          archiveError: null
        });

        const moved = await adapter.archiveClientRootFolder({ clientCodeUpper: client.code });
        await rewriteClientDropboxPaths({
          clientId: id,
          fromRoot: moved.fromPath,
          toRoot: moved.toPath
        });

        await updateClientArchiveState(id, {
          status: "completed",
          archiveError: null,
          archivedAt: new Date().toISOString()
        });
      } catch (error) {
        await updateClientArchiveState(id, {
          status: "failed",
          archiveError: getDropboxErrorSummary(error)
        });
      }
    });

    return ok({ pollUrl: getPollUrl(id) }, 202);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
