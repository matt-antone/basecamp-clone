import { describe, expect, it, vi } from "vitest";

import { BasecampClient } from "../src/basecamp/client.js";
import type { AppConfig } from "../src/config.js";

function createConfig(): AppConfig {
  return {
    accountId: "999999999",
    baseUrl: "https://basecamp.com/999999999/api/v1",
    userAgent: "Test Agent",
    auth: {
      mode: "basic",
      username: "user",
      password: "pass"
    },
    cacheTtlMs: 1_000,
    defaultLimit: 20,
    defaultHours: 24
  };
}

describe("BasecampClient", () => {
  it("retries rate-limited requests using retry-after", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: {
            "retry-after": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ ok: true }]), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      );

    const client = new BasecampClient(createConfig(), fetchImpl, sleep);
    const result = await client.getJson<Array<{ ok: boolean }>>("/projects");

    expect(result).toEqual([{ ok: true }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
