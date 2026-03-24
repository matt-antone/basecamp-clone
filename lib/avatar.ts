const ALLOWED_AVATAR_HOST_SUFFIXES = ["googleusercontent.com"];

export function getAvatarProxyUrl(sourceUrl: string) {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return "";
  }

  return `/avatar?src=${encodeURIComponent(trimmed)}`;
}

export function isAllowedAvatarUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    return ALLOWED_AVATAR_HOST_SUFFIXES.some(
      (suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}
