const PREFIX_REGEX = /^(\d{13})-(\d+)-(.+)$/;

export function stripPrefix(basename: string): string | null {
  const match = basename.match(PREFIX_REGEX);
  if (!match) return null;
  const remainder = match[3];
  return remainder.length > 0 ? remainder : null;
}

export function resolveCollision(target: string, taken: Set<string>): string {
  if (!taken.has(target)) {
    taken.add(target);
    return target;
  }

  const lastDot = target.lastIndexOf(".");
  const stem = lastDot > 0 ? target.slice(0, lastDot) : target;
  const ext = lastDot > 0 ? target.slice(lastDot) : "";

  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }

  throw new Error(`resolveCollision: exhausted suffix attempts for ${target}`);
}
