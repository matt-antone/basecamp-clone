import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { getSiteSettings, upsertSiteSettings } from "@/lib/repositories";
import { z } from "zod";

const patchSiteSettingsSchema = z.object({
  siteTitle: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable()
});

export async function GET() {
  try {
    const siteSettings = await getSiteSettings();
    return ok({
      siteSettings: {
        siteTitle: siteSettings?.siteTitle ?? null,
        logoUrl: siteSettings?.logoUrl ?? null
      }
    });
  } catch {
    return serverError();
  }
}

export async function PATCH(request: Request) {
  try {
    await requireUser(request);
    const payload = patchSiteSettingsSchema.parse(await request.json());
    const siteSettings = await upsertSiteSettings({
      siteTitle: typeof payload.siteTitle === "string" ? payload.siteTitle.trim() || null : null,
      logoUrl: typeof payload.logoUrl === "string" ? payload.logoUrl.trim() || null : null
    });
    return ok({ siteSettings });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (error instanceof Error && /site_settings table is not available/i.test(error.message)) {
      return serverError(error.message);
    }
    return serverError();
  }
}
