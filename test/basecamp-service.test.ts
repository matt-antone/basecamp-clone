import { describe, expect, it } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import type { AppConfig } from "../src/config.js";
import { BasecampClient } from "../src/basecamp/client.js";
import { BasecampService } from "../src/basecamp/service.js";
import { createRouteFetch, jsonResponse } from "./helpers/mock-fetch.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    accountId: "999999999",
    baseUrl: "https://basecamp.com/999999999/api/v1",
    userAgent: "Test Agent",
    auth: {
      mode: "basic",
      username: "user",
      password: "pass"
    },
    cacheTtlMs: 60_000,
    defaultLimit: 20,
    defaultHours: 24,
    ...overrides
  };
}

describe("BasecampService", () => {
  it("filters starred projects against the configured allowlist", async () => {
    const fetchImpl = createRouteFetch({
      "/999999999/api/v1/stars.json": () =>
        jsonResponse([
          { project_id: 10, created_at: "2026-03-03T00:00:00Z", url: "", app_url: "" },
          { project_id: 20, created_at: "2026-03-03T00:00:00Z", url: "", app_url: "" }
        ]),
      "/999999999/api/v1/projects.json": () =>
        jsonResponse([
          {
            id: 10,
            name: "Keep",
            description: null,
            updated_at: "2026-03-03T00:00:00Z",
            url: "https://example.test/projects/10",
            app_url: "https://example.test/app/projects/10",
            template: false,
            archived: false,
            starred: true,
            trashed: false,
            draft: false,
            is_client_project: false,
            color: "3185c5"
          },
          {
            id: 20,
            name: "Drop",
            description: null,
            updated_at: "2026-03-03T00:00:00Z",
            url: "https://example.test/projects/20",
            app_url: "https://example.test/app/projects/20",
            template: false,
            archived: false,
            starred: true,
            trashed: false,
            draft: false,
            is_client_project: false,
            color: "3185c5"
          }
        ])
    });

    const config = createConfig({
      allowedProjectIds: new Set([10])
    });
    const service = new BasecampService(
      new BasecampClient(config, fetchImpl),
      config,
      new TtlCache()
    );

    await expect(service.listStarredProjects()).resolves.toEqual([
      {
        id: 10,
        name: "Keep",
        description: null,
        updatedAt: "2026-03-03T00:00:00Z",
        archived: false,
        color: "3185c5",
        url: "https://example.test/projects/10",
        appUrl: "https://example.test/app/projects/10"
      }
    ]);
  });

  it("filters global activity to the starred project scope and normalizes records", async () => {
    const fetchImpl = createRouteFetch({
      "/999999999/api/v1/stars.json": () =>
        jsonResponse([
          { project_id: 10, created_at: "2026-03-03T00:00:00Z", url: "", app_url: "" }
        ]),
      "/999999999/api/v1/projects.json": () =>
        jsonResponse([
          {
            id: 10,
            name: "Scoped",
            description: null,
            updated_at: "2026-03-03T00:00:00Z",
            url: "https://example.test/projects/10",
            app_url: "https://example.test/app/projects/10",
            template: false,
            archived: false,
            starred: true,
            trashed: false,
            draft: false,
            is_client_project: false,
            color: "3185c5"
          }
        ]),
      "/999999999/api/v1/events.json": () =>
        jsonResponse([
          {
            id: 1,
            created_at: "2026-03-03T00:00:00Z",
            updated_at: "2026-03-03T00:00:00Z",
            action: "created a to-do",
            target: "Ship it",
            summary: "created a to-do: Ship it",
            url: "https://example.test/api/todos/1",
            html_url: "https://example.test/app/todos/1",
            creator: {
              id: 42,
              name: "Matt"
            },
            bucket: {
              id: 10,
              name: "Scoped",
              type: "Project",
              url: "",
              app_url: ""
            },
            eventable: {
              id: 100,
              type: "Todo",
              url: "",
              app_url: ""
            }
          },
          {
            id: 2,
            created_at: "2026-03-03T00:00:00Z",
            updated_at: "2026-03-03T00:00:00Z",
            action: "created a to-do",
            target: "Ignore it",
            summary: "created a to-do: Ignore it",
            url: "https://example.test/api/todos/2",
            html_url: "https://example.test/app/todos/2",
            creator: {
              id: 43,
              name: "Other"
            },
            bucket: {
              id: 20,
              name: "Other",
              type: "Project",
              url: "",
              app_url: ""
            },
            eventable: {
              id: 101,
              type: "Todo",
              url: "",
              app_url: ""
            }
          }
        ])
    });

    const config = createConfig();
    const service = new BasecampService(
      new BasecampClient(config, fetchImpl),
      config,
      new TtlCache()
    );

    const results = await service.getRecentActivity({
      since: "2026-03-02T00:00:00Z"
    });

    expect(results).toEqual([
      {
        id: 1,
        projectId: 10,
        projectName: "Scoped",
        entityId: 100,
        entityType: "Todo",
        action: "created a to-do",
        target: "Ship it",
        summary: "created a to-do: Ship it",
        creatorId: 42,
        creatorName: "Matt",
        createdAt: "2026-03-03T00:00:00Z",
        updatedAt: "2026-03-03T00:00:00Z",
        url: "https://example.test/api/todos/1",
        appUrl: "https://example.test/app/todos/1"
      }
    ]);
  });
});
