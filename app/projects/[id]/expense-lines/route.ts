import { requireUser } from "@/lib/auth";
import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { createProjectExpenseLine, getProject, listProjectExpenseLines } from "@/lib/repositories";
import { z } from "zod";

const expenseLineSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().min(0).max(9999999999.99),
  sortOrder: z.number().int().min(0).optional()
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id, user.id);
    if (!project) {
      return notFound("Project not found");
    }

    const expenseLines = await listProjectExpenseLines(id);
    return ok({ expenseLines });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const payload = expenseLineSchema.parse(await request.json());
    const project = await getProject(id, user.id);
    if (!project) {
      return notFound("Project not found");
    }

    const expenseLine = await createProjectExpenseLine({
      projectId: id,
      label: payload.label.trim(),
      amount: payload.amount,
      sortOrder: payload.sortOrder
    });
    return ok({ expenseLine }, 201);
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
