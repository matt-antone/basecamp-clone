// lib/imports/bc2-attachment-download.ts

export type Bc2DownloadEnv = {
  username: string;
  password: string;
  userAgent: string;
};

const DEFAULT_BACKOFF_MS = [5000, 15000, 30000, 60000] as const;

export type DownloadBc2AttachmentOptions = {
  backoffMs?: readonly number[];
  /** Called before sleeping on HTTP 429 (rate limit). */
  onBackoff?: (waitMs: number) => void;
};

/**
 * Download bytes from a BC2 attachment URL.
 * Tries HTTP Basic auth first; on 401/403 retries once without Authorization (pre-signed URLs).
 * On 429, honors Retry-After or uses exponential backoff (same defaults as migrate-bc2.ts).
 */
export async function downloadBc2Attachment(
  url: string,
  env: Bc2DownloadEnv,
  options?: DownloadBc2AttachmentOptions
): Promise<ArrayBuffer> {
  const backoffMs = options?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const basic =
    "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64");

  for (let dlAttempt = 0; dlAttempt <= backoffMs.length; dlAttempt++) {
    let res = await fetch(url, {
      headers: {
        Authorization: basic,
        "User-Agent": env.userAgent
      }
    });

    if (res.status === 401 || res.status === 403) {
      res = await fetch(url);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : (backoffMs[dlAttempt] ?? backoffMs[backoffMs.length - 1]!);
      options?.onBackoff?.(waitMs);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Failed to download attachment: HTTP ${res.status}`);
    }

    return res.arrayBuffer();
  }

  throw new Error("Failed to download attachment: too many 429 retries");
}
