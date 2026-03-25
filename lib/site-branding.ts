export const DEFAULT_SITE_TITLE = "Project Manager";
export const DEFAULT_SITE_LOGO_URL = "/gx-logo.webp";
export const SITE_DESCRIPTION = "Basecamp 2 replacement with Supabase + Dropbox";

export function normalizeSiteTitle(siteTitle: string | null | undefined) {
  const nextTitle = typeof siteTitle === "string" ? siteTitle.trim() : "";
  return nextTitle || DEFAULT_SITE_TITLE;
}

export function normalizeSiteLogoUrl(logoUrl: string | null | undefined) {
  const nextLogoUrl = typeof logoUrl === "string" ? logoUrl.trim() : "";
  return nextLogoUrl || DEFAULT_SITE_LOGO_URL;
}
