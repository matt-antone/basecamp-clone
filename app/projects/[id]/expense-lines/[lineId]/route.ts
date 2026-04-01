import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { deleteProjectExpenseLine, getProject, updateProjectExpenseLine } from "@/lib/repositories";
import { z } from "zod";

const patchExpenseLineSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    amount: z.number().min(0).max(9999999999.99).optional(),
    sortOrder: z.number().int().min(0).optional()
  })
  .refine((payload) => payload.label !== undefined || payload.amount !== undefined || payload.sortOrder !== undefined, {
    message: "At least one expense field is required"
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, lineId } = await params;
    const payload = patchExpenseLineSchema.parse(await request.json());
    const project = await getProject(id, user.id);
    if (!project) {
      return notFound("Project not found");
    }

    const expenseLine = await updateProjectExpenseLine({
      id: lineId,
      projectId: id,
      label: payload.label?.trim(),
      amount: payload.amount,
      sortOrder: payload.sortOrder
    });
    if (!expenseLine) {
      return notFound("Expense line not found");
    }

    return ok({ expenseLine });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (error instanceof Error && /expense/i.test(error.message)) {
      return badRequest(error.message);
    }
    return serverError();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { id, lineId } = await params;
    const project = await getProject(id, user.id);
    if (!project) {
      return notFound("Project not found");
    }

    const deleted = await deleteProjectExpenseLine({
      id: lineId,
      projectId: id
    });
    if (!deleted) {
      return notFound("Expense line not found");
    }

    return ok({ success: true });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}
