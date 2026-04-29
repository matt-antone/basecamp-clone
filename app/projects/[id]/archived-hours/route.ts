import { z } from "zod";
import { createProjectHoursPatchHandler } from "@/lib/project-hours-patch";

const patchArchivedHoursSchema = z.object({
  userId: z.string().min(1),
  hours: z.number().nonnegative().nullable()
});

export const PATCH = createProjectHoursPatchHandler({
  requireArchived: true,
  async resolveUserAndHours(request) {
    const payload = patchArchivedHoursSchema.parse(await request.json());
    return { userId: payload.userId, hours: payload.hours };
  }
});
