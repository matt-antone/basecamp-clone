"use client";

function normalizeUrl(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

export function getPublicSiteUrl(currentOrigin?: string | null) {
  return normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? normalizeUrl(currentOrigin);
}
