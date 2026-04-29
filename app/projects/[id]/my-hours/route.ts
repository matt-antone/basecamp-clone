import { z } from "zod";
import { createProjectHoursPatchHandler } from "@/lib/project-hours-patch";

const patchMyHoursSchema = z.object({
  hours: z.number().nonnegative().nullable()
});

export const PATCH = createProjectHoursPatchHandler({
  requireArchived: false,
  async resolveUserAndHours(request, user) {
    const payload = patchMyHoursSchema.parse(await request.json());
    return { userId: user.id, hours: payload.hours };
  }
});
