import { requireUser } from "@/lib/auth";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { DEFAULT_HOURLY_RATE_USD } from "@/lib/project-financials";
import { getSiteSettings, upsertSiteSettings } from "@/lib/repositories";
import { z } from "zod";

const patchSiteSettingsSchema = z.object({
  siteTitle: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  defaultHourlyRateUsd: z.number().min(0).max(999999.99).optional().nullable()
});

function normalizeHourlyRateForResponse(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_HOURLY_RATE_USD;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HOURLY_RATE_USD;
}

export async function GET() {
  try {
    const siteSettings = await getSiteSettings();
    return ok({
      siteSettings: {
        siteTitle: siteSettings?.siteTitle ?? null,
        logoUrl: siteSettings?.logoUrl ?? null,
        defaultHourlyRateUsd: normalizeHourlyRateForResponse(siteSettings?.defaultHourlyRateUsd)
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
    const currentSettings = await getSiteSettings();
    const siteSettings = await upsertSiteSettings({
      siteTitle:
        payload.siteTitle === undefined
          ? currentSettings?.siteTitle ?? null
          : typeof payload.siteTitle === "string"
            ? payload.siteTitle.trim() || null
            : null,
      logoUrl:
        payload.logoUrl === undefined
          ? currentSettings?.logoUrl ?? null
          : typeof payload.logoUrl === "string"
            ? payload.logoUrl.trim() || null
            : null,
      defaultHourlyRateUsd:
        payload.defaultHourlyRateUsd === undefined
          ? currentSettings?.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD
          : payload.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD
    });
    return ok({
      siteSettings: {
        siteTitle: siteSettings.siteTitle,
        logoUrl: siteSettings.logoUrl,
        defaultHourlyRateUsd: normalizeHourlyRateForResponse(siteSettings.defaultHourlyRateUsd)
      }
    });
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
