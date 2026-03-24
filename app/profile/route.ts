import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { getUserProfileById, updateUserProfile } from "@/lib/repositories";
import { z } from "zod";

const updateProfileSchema = z.object({
  firstName: z.string().trim().max(120).nullable(),
  lastName: z.string().trim().max(120).nullable(),
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .refine((value) => !value || /^https?:\/\/\S+$/i.test(value), "avatarUrl must be a valid URL"),
  jobTitle: z.string().trim().max(160).nullable(),
  timezone: z.string().trim().max(120).nullable(),
  bio: z.string().trim().max(2000).nullable()
});

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await getUserProfileById(user.id);
    return ok({ profile });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    return serverError();
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const payload = updateProfileSchema.parse(await request.json());
    const profile = await updateUserProfile({
      id: user.id,
      firstName: normalizeNullableString(payload.firstName),
      lastName: normalizeNullableString(payload.lastName),
      avatarUrl: normalizeNullableString(payload.avatarUrl),
      jobTitle: normalizeNullableString(payload.jobTitle),
      timezone: normalizeNullableString(payload.timezone),
      bio: normalizeNullableString(payload.bio)
    });

    if (!profile) {
      return badRequest("Profile not found");
    }

    return ok({ profile });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
