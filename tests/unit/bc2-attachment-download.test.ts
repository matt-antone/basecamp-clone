import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBc2Attachment } from "@/lib/imports/bc2-attachment-download";

describe("downloadBc2Attachment", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("retries without Authorization when first response is 403", async () => {
    const url = "https://basecamp.example.com/attachments/1/download";
    const authed = new Response(null, { status: 403 });
    const ok = new Response(new Uint8Array([1, 2, 3]), { status: 200 });

    vi.mocked(fetch)
      .mockResolvedValueOnce(authed)
      .mockResolvedValueOnce(ok);

    const buf = await downloadBc2Attachment(url, {
      username: "user",
      password: "pass",
      userAgent: "TestAgent/1"
    });

    expect(Buffer.from(new Uint8Array(buf)).equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(first.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      "User-Agent": "TestAgent/1"
    });
    const secondCall = vi.mocked(fetch).mock.calls[1];
    expect(secondCall![0]).toBe(url);
    expect(secondCall![1]).toBeUndefined();
  });
});
