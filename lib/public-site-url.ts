function normalizeSiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  return url.origin;
}

export function getPublicSiteUrl(currentOrigin: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeSiteUrl(configured);
  }

  return normalizeSiteUrl(currentOrigin);
}
