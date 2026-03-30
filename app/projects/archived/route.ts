import { ok, serverError } from "@/lib/http";
import { listArchivedProjectsPaginated } from "@/lib/repositories";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const status = url.searchParams.get("status") ?? "all";
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const result = await listArchivedProjectsPaginated({ search, status, page, limit });
    return ok(result);
  } catch (error) {
    console.error("archived_projects_fetch_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return serverError();
  }
}
