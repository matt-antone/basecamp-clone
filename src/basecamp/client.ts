import { BasecampApiError } from "../errors.js";
import type { AppConfig } from "../config.js";

type RequestOptions = {
  searchParams?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
};

export type FetchLike = typeof fetch;
type RequestTarget = string | URL;

export class BasecampClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, options, 0, undefined);
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

  async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {}, 0, body);
  }

  async *iterateCollection<T>(
    path: string,
    options: RequestOptions = {}
  ): AsyncGenerator<T, void, void> {
    let nextTarget: RequestTarget | undefined = path;
    let pageOptions: RequestOptions = options;

    while (nextTarget) {
      const response = await this.requestResponse(nextTarget, pageOptions, 0, undefined);
      const payload = (await response.json()) as unknown;

      if (!Array.isArray(payload)) {
        throw new Error("Expected array response while traversing paginated collection.");
      }

      for (const record of payload as T[]) {
        yield record;
      }

      const nextUrl = this.extractNextLink(response.headers.get("link"));
      nextTarget = nextUrl;
      pageOptions = {};
    }
  }

  async getCollectionAll<T>(path: string, options: RequestOptions = {}): Promise<T[]> {
    const records: T[] = [];

    for await (const record of this.iterateCollection<T>(path, options)) {
      records.push(record);
    }

    return records;
  }

  async createAttachment(fileContent: Buffer, contentType: string): Promise<{ token: string }> {
    return this.postBinary<{ token: string }>("/attachments", fileContent, contentType);
  }

  async postBinary<T>(path: string, body: Buffer, contentType: string): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path.endsWith(".json") ? path : `${path}.json`}`);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: this.getAuthorizationHeader(),
        "User-Agent": this.config.userAgent,
        "Content-Type": contentType,
        "Content-Length": String(body.length)
      },
      body
    });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return (await response.json()) as T;
  }

  async downloadBinary(
    sourceUrl: string,
    timeoutMs: number
  ): Promise<{ body: Buffer; contentType: string | null }> {
    const url = new URL(sourceUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.requestResponse(url, {}, 0, undefined, {
        Accept: "*/*"
      }, controller.signal);
      const body = Buffer.from(await response.arrayBuffer());
      return {
        body,
        contentType: response.headers.get("content-type")
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Download timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(
    path: string,
    options: RequestOptions,
    attempt: number,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.requestResponse(path, options, attempt, body);
    return (await response.json()) as T;
  }

  private async requestResponse(
    target: RequestTarget,
    options: RequestOptions,
    attempt: number,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Response> {
    const url = this.buildRequestUrl(target, options.searchParams);
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        Authorization: this.getAuthorizationHeader(),
        "User-Agent": this.config.userAgent,
        ...(extraHeaders ?? {})
      },
      signal
    };

    if (body !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, init);

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
      return this.requestResponse(
        target,
        options,
        attempt + 1,
        body,
        extraHeaders,
        signal
      );
    }

    if (!response.ok) {
      throw await this.buildError(response);
    }

    return response;
  }

  private buildRequestUrl(
    target: RequestTarget,
    searchParams: Record<string, string | number | undefined> | undefined
  ): URL {
    const url =
      typeof target === "string"
        ? new URL(
            `${this.config.baseUrl}${target.endsWith(".json") ? target : `${target}.json`}`
          )
        : new URL(target.toString());

    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private extractNextLink(linkHeader: string | null): URL | undefined {
    if (!linkHeader) {
      return undefined;
    }

    for (const segment of linkHeader.split(",")) {
      const match = segment.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/i);

      if (!match) {
        continue;
      }

      const [, href, rel] = match;
      if (!href || rel?.toLowerCase() !== "next") {
        continue;
      }

      return new URL(href, this.config.baseUrl);
    }

    return undefined;
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
