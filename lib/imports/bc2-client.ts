// lib/imports/bc2-client.ts

const BC2_BASE = "https://basecamp.com";
const BACKOFF_SEQUENCE_MS = [1000, 2000, 4000, 8000, 16000, 30000];

interface Bc2ClientOptions {
  accountId: string;
  username: string;
  password: string;
  userAgent: string;
  requestDelayMs?: number;
}

export interface Bc2Response<T = unknown> {
  body: T;
  nextUrl: string | null;
}

function parseNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function makeAuthHeader(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Bc2Client {
  private accountId: string;
  private authHeader: string;
  private userAgent: string;
  private requestDelayMs: number;

  constructor(options: Bc2ClientOptions) {
    this.accountId = options.accountId;
    this.authHeader = makeAuthHeader(options.username, options.password);
    this.userAgent = options.userAgent;
    this.requestDelayMs = options.requestDelayMs ?? 200;
  }

  async get<T = unknown>(path: string): Promise<Bc2Response<T>> {
    const url = path.startsWith("https://")
      ? path
      : `${BC2_BASE}/${this.accountId}/api/v1${path}`;

    if (this.requestDelayMs > 0) {
      await sleep(this.requestDelayMs);
    }

    for (let attempt = 0; attempt <= BACKOFF_SEQUENCE_MS.length; attempt++) {
      const response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          "User-Agent": this.userAgent,
          Accept: "application/json"
        }
      });

      if (response.status === 429) {
        const backoff = BACKOFF_SEQUENCE_MS[attempt];
        if (backoff === undefined) {
          throw new Error(`BC2 rate limit: max retries exceeded for ${url}`);
        }
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        throw new Error(`BC2 API error ${response.status} for ${url}`);
      }

      const body = (await response.json()) as T;
      const nextUrl = parseNextUrl(response.headers.get("Link"));
      return { body, nextUrl };
    }

    throw new Error(`BC2 rate limit: max retries exceeded for ${url}`);
  }
}
