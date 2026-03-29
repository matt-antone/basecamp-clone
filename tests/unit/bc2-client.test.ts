// tests/unit/bc2-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bc2Client } from "@/lib/imports/bc2-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("Bc2Client", () => {
  let client: Bc2Client;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new Bc2Client({
      accountId: "12345",
      accessToken: "mytoken",
      userAgent: "Test (test@example.com)",
      requestDelayMs: 0
    });
  });

  it("sends correct auth and user-agent headers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await client.get("/people.json");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("basecampapi.com/12345/people.json");
    expect(init.headers["Authorization"]).toMatch(/^Basic /);
    expect(init.headers["User-Agent"]).toBe("Test (test@example.com)");
  });

  it("returns parsed JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 1, name: "Alice" }]));
    const result = await client.get("/people.json");
    expect(result.body).toEqual([{ id: 1, name: "Alice" }]);
    expect(result.nextUrl).toBeNull();
  });

  it("parses next URL from Link header", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 1 }], 200, {
        Link: '<https://basecampapi.com/12345/people.json?page=2>; rel="next"'
      })
    );
    const result = await client.get("/people.json");
    expect(result.nextUrl).toBe("https://basecampapi.com/12345/people.json?page=2");
  });

  it("retries on 429 with exponential backoff", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = client.get("/projects.json");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.body).toEqual({ ok: true });
    vi.useRealTimers();
  });

  it("throws after max backoff attempts exceeded", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const promise = client.get("/projects.json");
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/rate limit/i);
    vi.useRealTimers();
  });
});
