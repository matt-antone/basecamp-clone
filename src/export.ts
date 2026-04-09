import path from "node:path";

import { BasecampClient } from "./basecamp/client.js";
import { loadConfig, type AppConfig } from "./config.js";
import { runExportPipeline } from "./export/pipeline.js";
import {
  EXPORT_STATUSES,
  type ExportPipelineOptions,
  type ExportStatus
} from "./export/types.js";

type ParsedArgs = {
  outputDir?: string;
  statuses?: ExportStatus[];
  resume: boolean;
  dryRun: boolean;
  downloadTimeoutMs?: number;
  maxConcurrency?: number;
  maxMissingDownloads?: number;
  help: boolean;
};

function printHelp(): void {
  console.log(`Basecamp export CLI

Usage:
  npm run export -- [options]

Options:
  --output <dir>                   Output directory
  --statuses <csv>                 Comma-separated statuses (active,archived,trashed)
  --resume                         Resume from checkpoint in output directory
  --dry-run                        Build graph/manifests without downloading binaries
  --download-timeout-ms <number>   Timeout per file download (ms)
  --max-concurrency <number>       Max parallel downloads
  --max-missing-downloads <number> Allowed failed downloadable files before failure
  --help                           Show this help message
`);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${raw}".`);
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received "${raw}".`);
  }
  return parsed;
}

function parseStatuses(raw: string | undefined): ExportStatus[] {
  if (!raw) {
    return [...EXPORT_STATUSES];
  }

  const values = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set(EXPORT_STATUSES);
  for (const value of values) {
    if (!allowed.has(value as ExportStatus)) {
      throw new Error(
        `Unsupported status "${value}". Allowed: ${EXPORT_STATUSES.join(", ")}.`
      );
    }
  }

  return [...new Set(values)] as ExportStatus[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    resume: false,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index] ?? "";
    switch (current) {
      case "--output":
        parsed.outputDir = argv[index + 1];
        index += 1;
        break;
      case "--statuses":
        parsed.statuses = parseStatuses(argv[index + 1]);
        index += 1;
        break;
      case "--resume":
        parsed.resume = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--download-timeout-ms":
        parsed.downloadTimeoutMs = parsePositiveInt(argv[index + 1], 30_000);
        index += 1;
        break;
      case "--max-concurrency":
        parsed.maxConcurrency = parsePositiveInt(argv[index + 1], 4);
        index += 1;
        break;
      case "--max-missing-downloads":
        parsed.maxMissingDownloads = parseNonNegativeInt(argv[index + 1], 0);
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        if (current.startsWith("--")) {
          throw new Error(`Unknown option "${current}". Use --help for usage.`);
        }
    }
  }

  return parsed;
}

function resolveOutputDir(cliOutputDir: string | undefined, config: AppConfig): string {
  if (cliOutputDir) {
    return path.resolve(process.cwd(), cliOutputDir);
  }

  const baseDir = config.exportOutputDir?.trim() || "./exports";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), baseDir, `basecamp-${stamp}`);
}

function buildPipelineOptions(
  args: ParsedArgs,
  config: AppConfig
): ExportPipelineOptions {
  const statuses = args.statuses ?? config.exportIncludeStatuses ?? [...EXPORT_STATUSES];

  return {
    outputDir: resolveOutputDir(args.outputDir, config),
    statuses,
    resume: args.resume,
    dryRun: args.dryRun,
    downloadTimeoutMs:
      args.downloadTimeoutMs ?? config.exportDownloadTimeoutMs ?? 30_000,
    maxConcurrency: args.maxConcurrency ?? config.exportMaxConcurrency ?? 4,
    maxMissingDownloads:
      args.maxMissingDownloads ??
      parseNonNegativeInt(process.env.BASECAMP_EXPORT_MAX_MISSING_DOWNLOADS, 0)
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const client = new BasecampClient(config);
  const options = buildPipelineOptions(args, config);

  const manifest = await runExportPipeline(client, options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDir: manifest.outputDir,
        statuses: manifest.statuses,
        counts: manifest.counts,
        artifacts: manifest.artifacts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Export failed: ${message}`);
  process.exit(1);
});
