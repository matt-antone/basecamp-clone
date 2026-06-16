import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { addProjectFavorite, removeProjectFavorite } from "@/lib/repositories";
import { z } from "zod";

const idSchema = z.string().uuid();

type RouteContext = { params: Promise<{ id: string }> };

async function favoriteMutation(
  request: Request,
  params: RouteContext["params"],
  mutate: (userId: string, projectId: string) => Promise<void>
) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return badRequest("Invalid project id");
    }
    await mutate(user.id, id);
    return ok({});
  } catch (error) {
    console.error("project_favorite_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  return favoriteMutation(request, params, addProjectFavorite);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return favoriteMutation(request, params, removeProjectFavorite);
}
