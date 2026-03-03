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
- Uses local environment variables for configuration
- Keeps transport wiring separate from Basecamp logic so HTTP can be added later

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local env file from the example:

```bash
cp .env.example .env
```

3. Set your Basecamp credentials in `.env`.

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

Keep `.env` uncommitted. This repo’s `.gitignore` already excludes it.

## Run The Server

For local MCP clients that spawn a server over `stdio`:

```bash
npm run dev
```

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

## Verification

```bash
npm run typecheck
npm test
```

## Later

This first version is intentionally `stdio`-only. If you later want a shared or remote MCP service, add an HTTP transport adapter on top of the existing Basecamp service and tool layer instead of rewriting the query logic.
