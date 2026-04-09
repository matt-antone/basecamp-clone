# Basecamp MCP Server

Local Basecamp 2 MCP server that exposes a small, query-first toolset over `stdio`.

## What It Does

- Limits project-scoped queries to your starred Basecamp projects by default
- Exposes MCP tools for:
  - `list_starred_projects`
  - `get_project_activity`
  - `get_project_messages`
  - `get_project_documents`
  - `get_open_todos`
  - `list_project_members`
  - `post_comment`
- Uses local environment variables for configuration
- Keeps transport wiring separate from Basecamp logic so HTTP can be added later

## Local Setup

1. Install dependencies:

```bash
npm install
```

1. Create a local env file from the example:

```bash
cp .env.example .env
```

1. Set your Basecamp credentials in `.env`.

Required variables:

- `BASECAMP_ACCOUNT_ID`
- `BASECAMP_AUTH_MODE`
- `BASECAMP_USERNAME` and `BASECAMP_PASSWORD` for basic auth

Optional variables:

- `BASECAMP_USER_AGENT`
- `BASECAMP_CACHE_TTL_MS`
- `BASECAMP_DEFAULT_LIMIT`
- `BASECAMP_DEFAULT_HOURS`
- `BASECAMP_ALLOWED_PROJECT_IDS`
- `BASECAMP_ATTACHMENTS_CWD` – directory used to resolve relative `attachmentPaths` in `post_comment` (defaults to the server process cwd; set to your workspace path if attachments are not found)
- `MCP_PORT` – port for the HTTP/SSE server when using `npm run serve` (default: 3847)
- `BASECAMP_EXPORT_OUTPUT_DIR` – base directory used by export CLI when `--output` is not provided
- `BASECAMP_EXPORT_MAX_CONCURRENCY` – max parallel downloads for export artifacts
- `BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS` – per-download timeout for export files
- `BASECAMP_EXPORT_INCLUDE_STATUSES` – default statuses for export runs (`active,archived,trashed`)

Keep `.env` uncommitted. This repo’s `.gitignore` already excludes it.

## Use in Cursor or Codex

**Cursor (HTTP/SSE – multiple windows)**

- Run the server once so it stays up: `npm run serve` (listens on `http://127.0.0.1:3847/sse` by default).
- `.cursor/mcp.json` in this repo points Cursor at that URL. Every Cursor window (this project or others) can use the same running server; no need to spawn a process per window.
- Start the server in a terminal (or in the background), then use Basecamp tools from any Cursor window. Restart Cursor’s MCP list if the server was not running when Cursor started.

**Cursor (stdio – single process)**

- To have Cursor spawn the server per window instead, change `.cursor/mcp.json` to use a command, e.g. `"command": "bash"`, `"args": ["-c", "cd /path/to/BasecampClient && npm run dev"]`, and set the working directory to this repo so `.env` is loaded.

**Codex**

- Project-scoped: with `.codex/config.toml` in this repo, Codex uses the `basecamp` MCP server when working in this project (it runs `npm run dev` from the project root).
- Global: add the same `[mcp_servers.basecamp]` block to `~/.codex/config.toml` and set `cwd` to this repo’s absolute path so `.env` is found, e.g. `cwd = "/Users/you/Current Dev Projects/BasecampClient"`.

Restart Cursor or Codex after changing MCP config.

## Run The Server

**HTTP/SSE (one server, multiple Cursor windows)**

```bash
npm run serve
```

Listens on `http://127.0.0.1:3847/sse` (or `MCP_PORT` from `.env`). Use this when you want the server running all the time and want to connect from multiple Cursor windows.

**stdio (one process per client)**

```bash
npm run dev
```

For clients that spawn the server over stdio (e.g. `npm run dev` from this repo).

To build first and run compiled output:

```bash
npm run build
npm start
```

## Tool Behavior

### `list_starred_projects`

Returns the current starred projects in normalized project form.

### `get_project_activity`

Returns recent activity for one starred project or all starred projects.

Supported filters:

- `projectId`
- `since`
- `hours`
- `eventType`
- `limit`

### `get_project_messages`

Returns recent message topics for one starred project or all starred projects.

Supported filters:

- `projectId`
- `since`
- `hours`
- `limit`

### `get_project_documents`

Returns recent documents for one starred project or all starred projects.

Supported filters:

- `projectId`
- `since`
- `hours`
- `limit`

### `get_open_todos`

Returns open assigned todos across starred projects. Defaults to the authenticated user from `people/me`.

Supported filters:

- `projectId`
- `assigneeId`
- `dueSince`
- `limit`

### `list_project_members`

Returns all people with access to a starred project (id, name, emailAddress). Use the returned ids in `post_comment`’s `subscribers` parameter to choose who gets notified.

Parameters:

- `projectId` – starred project ID

### `post_comment`

Posts a comment on a message in a starred project.

Parameters:

- `projectId` – starred project ID (from `list_starred_projects` or `get_project_messages`)
- `messageId` – message ID used in the message URL (the `messageId` field from `get_project_messages`)
- `content` – comment body (plain text)
- `subscribers` – optional array of person IDs (from `list_project_members`) to notify
- `newSubscriberEmails` – optional array of email addresses to loop in (for people without Basecamp accounts)
- `attachmentPaths` – optional array of file paths to attach to the comment (resolved by the server; files are uploaded to Basecamp then attached)

Returns the created comment id, content, createdAt, and appUrl to the new comment.

## Full Export CLI

Run a full graph/file export pipeline without changing existing MCP query tools:

```bash
npm run export -- --statuses active,archived,trashed --output ./exports/basecamp-run --resume
```

Artifacts written to output:

- `coverage-matrix.json`
- `nodes.ndjson`
- `edges.ndjson`
- `files/` (content-addressed by SHA-256 for downloadable files)
- `checkpoint.json`
- `dead-letter.ndjson`
- `manifest.json`

Useful flags:

- `--dry-run`
- `--download-timeout-ms <ms>`
- `--max-concurrency <n>`
- `--max-missing-downloads <n>`

## Verification

```bash
npm run typecheck
npm test
```

## Later

This first version is intentionally `stdio`-only. If you later want a shared or remote MCP service, add an HTTP transport adapter on top of the existing Basecamp service and tool layer instead of rewriting the query logic.
