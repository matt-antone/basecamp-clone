# Agent guide: Basecamp MCP server

Use this file in other projects so agents know how to use the Basecamp MCP server. Copy `AGENTS.md` into the project root or `.cursor/` and ensure the Basecamp server is running and configured (see **Setup** below).

## When to use Basecamp tools

- **Reading**: Listing projects, activity, messages, documents, open todos, or project members.
- **Writing**: Posting a comment on a message (with optional subscribers and attachments).

All tools operate only on **starred** Basecamp projects. Prefer **scoped queries** (e.g. one `projectId`) over broad ones when the user’s intent is project-specific.

## Setup (for other projects)

The Basecamp MCP server runs separately (from the BasecampClient repo). To use it from another project:

1. **Start the server** from the BasecampClient repo: `npm run serve` (default: `http://127.0.0.1:3847/sse`).
2. **Point Cursor at it** via `.cursor/mcp.json` in this project (or globally):

```json
{
  "mcpServers": {
    "basecamp": {
      "url": "http://127.0.0.1:3847/sse",
      "transport": "streamableHttp"
    }
  }
}
```

If the server wasn’t running when Cursor started, refresh Cursor’s MCP list. Credentials and options (e.g. `BASECAMP_ALLOWED_PROJECT_IDS`) are set in the BasecampClient repo’s `.env`.

## Tools reference

| Tool | Purpose | Key parameters |
|------|--------|----------------|
| `list_starred_projects` | List starred projects | (none) |
| `get_project_activity` | Recent activity (one or all starred projects) | `projectId`, `since`, `hours`, `eventType`, `limit` (max 100) |
| `get_project_messages` | Recent message topics | `projectId`, `since`, `hours`, `limit` (max 100) |
| `get_project_documents` | Recent documents | `projectId`, `since`, `hours`, `limit` (max 100) |
| `get_open_todos` | Open assigned todos (default: current user) | `projectId`, `assigneeId`, `dueSince`, `limit` (max 100) |
| `list_project_members` | People on a starred project (for `post_comment` subscribers) | `projectId` (required) |
| `post_comment` | Comment on a message | `projectId`, `messageId`, `content` (required); optional: `subscribers`, `newSubscriberEmails`, `attachmentPaths` |

## ID semantics

- **projectId**: From `list_starred_projects` (e.g. `projects[].id`) or from any `get_project_*` / `get_open_todos` result. Use for scoping and for `post_comment`.
- **messageId**: For `post_comment`, use the **messageId** field from `get_project_messages` (this is the ID used in the message URL), not the topic `id`.
- **Person IDs**: From `list_project_members` (e.g. `members[].id`). Pass as `subscribers` in `post_comment` to notify those people.

## Posting comments

1. Get the message: `get_project_messages` with the right `projectId` (and optional `hours`/`limit`).
2. Use that message’s `messageId` and the same `projectId` in `post_comment`.
3. Optionally get `list_project_members` for that `projectId` and pass `subscribers` (array of member ids) or `newSubscriberEmails` (array of emails for people without Basecamp accounts).
4. **Attachments**: `attachmentPaths` is an array of file paths. Paths are resolved by the server (typically from `BASECAMP_ATTACHMENTS_CWD` or the server process cwd). Use paths the server can read (e.g. absolute or relative to the configured cwd).

## Time filters

- **since**: ISO 8601 date-time (e.g. `2025-03-01T00:00:00Z`).
- **hours**: Integer (e.g. `24` for last day); max 2160.
- **dueSince**: For `get_open_todos`, date in `YYYY-MM-DD` format.

Use either `since` or `hours` for activity/messages/documents; don’t mix in a single call.

## Errors

- **Scope/config**: The server returns a clear message if a project isn’t starred or isn’t allowed (e.g. `BASECAMP_ALLOWED_PROJECT_IDS`). Don’t retry with the same project.
- **Rate limits**: On 429, the server may include a retry-after hint. Back off and retry once after the suggested delay.
- **Connection**: If tools fail with connection errors, remind the user to start the Basecamp server (`npm run serve` in BasecampClient) and check `.cursor/mcp.json`.

## Best practices

1. **Scope first**: Prefer `list_starred_projects` then one `projectId` for activity/messages/documents/todos when the user is asking about a single project or thread.
2. **Reuse IDs**: Use `projectId` and `messageId` from prior tool results; don’t guess IDs.
3. **Limit size**: Use `limit` (e.g. 10–25) when you only need a few items to reduce payload and latency.
4. **Attachments**: When using `attachmentPaths`, ensure files exist and the server’s cwd (or `BASECAMP_ATTACHMENTS_CWD`) is set so paths resolve correctly.
