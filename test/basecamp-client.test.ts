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
    defaultHours: 24,
    exportOutputDir: "./exports",
    exportMaxConcurrency: 4,
    exportDownloadTimeoutMs: 30_000,
    exportIncludeStatuses: ["active", "archived", "trashed"]
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

  it("iterates paginated collections using Link rel=next until exhausted", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://basecamp.com/999999999/api/v1/projects.json?page=2>; rel="next"'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 2 }]), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      );

    const client = new BasecampClient(createConfig(), fetchImpl);
    const records = await client.getCollectionAll<{ id: number }>("/projects");

    expect(records).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe(
      "/999999999/api/v1/projects.json"
    );
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get("page")).toBe(
      "2"
    );
  });

  it("preserves status filters on the first paginated request for project enumeration", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const client = new BasecampClient(createConfig(), fetchImpl);
    await client.getCollectionAll("/projects", {
      searchParams: {
        status: "archived"
      }
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("status")).toBe("archived");
  });
});
