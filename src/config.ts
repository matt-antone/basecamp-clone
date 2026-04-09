import { config as loadDotEnv } from "dotenv";
import * as z from "zod/v4";

import { ConfigurationError } from "./errors.js";

loadDotEnv();

const envSchema = z.object({
  BASECAMP_ACCOUNT_ID: z.string().min(1),
  BASECAMP_BASE_URL: z.string().url().optional(),
  BASECAMP_USER_AGENT: z.string().min(1).optional(),
  BASECAMP_AUTH_MODE: z.enum(["basic", "bearer"]).optional(),
  BASECAMP_USERNAME: z.string().min(1).optional(),
  BASECAMP_PASSWORD: z.string().min(1).optional(),
  BASECAMP_ACCESS_TOKEN: z.string().min(1).optional(),
  BASECAMP_ALLOWED_PROJECT_IDS: z.string().optional(),
  BASECAMP_CACHE_TTL_MS: z.string().optional(),
  BASECAMP_DEFAULT_LIMIT: z.string().optional(),
  BASECAMP_DEFAULT_HOURS: z.string().optional(),
  BASECAMP_EXPORT_OUTPUT_DIR: z.string().optional(),
  BASECAMP_EXPORT_MAX_CONCURRENCY: z.string().optional(),
  BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS: z.string().optional(),
  BASECAMP_EXPORT_INCLUDE_STATUSES: z.string().optional()
});

const allowedExportStatuses = new Set(["active", "archived", "trashed"]);

export type ExportStatus = "active" | "archived" | "trashed";

export type AppConfig = {
  accountId: string;
  baseUrl: string;
  userAgent: string;
  auth:
    | {
        mode: "basic";
        username: string;
        password: string;
      }
    | {
        mode: "bearer";
        accessToken: string;
      };
  allowedProjectIds?: Set<number>;
  cacheTtlMs: number;
  defaultLimit: number;
  defaultHours: number;
  exportOutputDir?: string;
  exportMaxConcurrency?: number;
  exportDownloadTimeoutMs?: number;
  exportIncludeStatuses?: ExportStatus[];
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}

function parseAllowedProjectIds(value: string | undefined): Set<number> | undefined {
  if (!value) {
    return undefined;
  }

  const ids = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));

  if (ids.some((id) => !Number.isFinite(id) || id <= 0)) {
    throw new ConfigurationError(
      "BASECAMP_ALLOWED_PROJECT_IDS must be a comma-separated list of positive integers."
    );
  }

  return new Set(ids);
}

function resolveBaseUrl(accountId: string, baseUrlOverride: string | undefined): string {
  return baseUrlOverride ?? `https://basecamp.com/${accountId}/api/v1`;
}

function parseExportStatuses(value: string | undefined): ExportStatus[] {
  if (!value) {
    return ["active", "archived", "trashed"];
  }

  const statuses = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (statuses.length === 0) {
    throw new ConfigurationError(
      "BASECAMP_EXPORT_INCLUDE_STATUSES must include at least one status."
    );
  }

  for (const status of statuses) {
    if (!allowedExportStatuses.has(status)) {
      throw new ConfigurationError(
        `BASECAMP_EXPORT_INCLUDE_STATUSES contains unsupported status \"${status}\".`
      );
    }
  }

  return [...new Set(statuses)] as ExportStatus[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const authMode =
    parsed.BASECAMP_AUTH_MODE ??
    (parsed.BASECAMP_ACCESS_TOKEN ? "bearer" : "basic");

  if (authMode === "basic") {
    if (!parsed.BASECAMP_USERNAME || !parsed.BASECAMP_PASSWORD) {
      throw new ConfigurationError(
        "BASECAMP_USERNAME and BASECAMP_PASSWORD are required for basic auth."
      );
    }

    return {
      accountId: parsed.BASECAMP_ACCOUNT_ID,
      baseUrl: resolveBaseUrl(
        parsed.BASECAMP_ACCOUNT_ID,
        parsed.BASECAMP_BASE_URL
      ),
      userAgent:
        parsed.BASECAMP_USER_AGENT ??
        "Basecamp MCP Server (matthewantone@example.com)",
      auth: {
        mode: "basic",
        username: parsed.BASECAMP_USERNAME,
        password: parsed.BASECAMP_PASSWORD
      },
      allowedProjectIds: parseAllowedProjectIds(parsed.BASECAMP_ALLOWED_PROJECT_IDS),
      cacheTtlMs: parsePositiveInt(parsed.BASECAMP_CACHE_TTL_MS, 30_000),
      defaultLimit: parsePositiveInt(parsed.BASECAMP_DEFAULT_LIMIT, 20),
      defaultHours: parsePositiveInt(parsed.BASECAMP_DEFAULT_HOURS, 168),
      exportOutputDir:
        parsed.BASECAMP_EXPORT_OUTPUT_DIR?.trim() || "./exports",
      exportMaxConcurrency: parsePositiveInt(
        parsed.BASECAMP_EXPORT_MAX_CONCURRENCY,
        4
      ),
      exportDownloadTimeoutMs: parsePositiveInt(
        parsed.BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS,
        10_000
      ),
      exportIncludeStatuses: parseExportStatuses(
        parsed.BASECAMP_EXPORT_INCLUDE_STATUSES
      )
    };
  }

  if (!parsed.BASECAMP_ACCESS_TOKEN) {
    throw new ConfigurationError(
      "BASECAMP_ACCESS_TOKEN is required for bearer auth."
    );
  }

  return {
    accountId: parsed.BASECAMP_ACCOUNT_ID,
    baseUrl: resolveBaseUrl(
      parsed.BASECAMP_ACCOUNT_ID,
      parsed.BASECAMP_BASE_URL
    ),
    userAgent:
      parsed.BASECAMP_USER_AGENT ??
      "Basecamp MCP Server (matthewantone@example.com)",
    auth: {
      mode: "bearer",
      accessToken: parsed.BASECAMP_ACCESS_TOKEN
    },
    allowedProjectIds: parseAllowedProjectIds(parsed.BASECAMP_ALLOWED_PROJECT_IDS),
    cacheTtlMs: parsePositiveInt(parsed.BASECAMP_CACHE_TTL_MS, 30_000),
    defaultLimit: parsePositiveInt(parsed.BASECAMP_DEFAULT_LIMIT, 20),
    defaultHours: parsePositiveInt(parsed.BASECAMP_DEFAULT_HOURS, 168),
    exportOutputDir:
      parsed.BASECAMP_EXPORT_OUTPUT_DIR?.trim() || "./exports",
    exportMaxConcurrency: parsePositiveInt(
      parsed.BASECAMP_EXPORT_MAX_CONCURRENCY,
      4
    ),
    exportDownloadTimeoutMs: parsePositiveInt(
      parsed.BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS,
      10_000
    ),
    exportIncludeStatuses: parseExportStatuses(
      parsed.BASECAMP_EXPORT_INCLUDE_STATUSES
    )
  };
}
