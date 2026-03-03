import { BasecampApiError } from "../errors.js";
import type { AppConfig } from "../config.js";

type RequestOptions = {
  searchParams?: Record<string, string | number | undefined>;
};

export type FetchLike = typeof fetch;

export class BasecampClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, options, 0);
  }

  async getCollectionPage<T>(
    path: string,
    page: number,
    options: RequestOptions = {}
  ): Promise<T[]> {
    return this.getJson<T[]>(path, {
      ...options,
      searchParams: {
        ...options.searchParams,
        page
      }
    });
  }

  private async request<T>(
    path: string,
    options: RequestOptions,
    attempt: number
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path.endsWith(".json") ? path : `${path}.json`}`);

    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: this.getAuthorizationHeader(),
        "User-Agent": this.config.userAgent
      }
    });

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 2) {
        throw await this.buildError(response);
      }

      const retryAfterSeconds = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10
      );
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1_000
        : 250 * 2 ** attempt;

      await this.sleep(delayMs);
      return this.request<T>(path, options, attempt + 1);
    }

    if (!response.ok) {
      throw await this.buildError(response);
    }

    return (await response.json()) as T;
  }

  private getAuthorizationHeader(): string {
    if (this.config.auth.mode === "basic") {
      const encoded = Buffer.from(
        `${this.config.auth.username}:${this.config.auth.password}`
      ).toString("base64");
      return `Basic ${encoded}`;
    }

    return `Bearer ${this.config.auth.accessToken}`;
  }

  private async buildError(response: Response): Promise<BasecampApiError> {
    const body = await response.text();
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);

    return new BasecampApiError(
      `Basecamp request failed with status ${response.status}.`,
      {
        status: response.status,
        body,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined
      }
    );
  }
}
