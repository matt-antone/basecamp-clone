## Why

The current idea of syncing Basecamp activity into Open Brain risks capturing large amounts of irrelevant project noise because the user is included in many projects they do not actively work on. This change instead introduces a local Basecamp 2 MCP server so AI can query only the Basecamp context that matters, with starred projects acting as the default project-level scope.

## What Changes

- Add a local Basecamp 2 MCP server that exposes query tools for AI clients.
- Limit accessible project data to projects the authenticated Basecamp user has starred by default.
- Expose high-signal tools for starred projects, recent project activity, messages, documents, and the user’s todos.
- Support scoped filtering so AI can ask targeted questions such as “what changed in my starred projects?” or “what are my open todos?”
- Add configuration for Basecamp credentials, account targeting, cache behavior, and optional scope overrides.

## Capabilities

### New Capabilities
- `basecamp-starred-project-query`: Query Basecamp 2 data from starred projects and expose it in a form AI can use on demand.
- `basecamp-mcp-server`: Run a local MCP server that provides Basecamp tools with consistent auth, filtering, and error handling.

### Modified Capabilities

None.

## Impact

- Adds a new local MCP server and supporting configuration in this repository.
- Integrates with the Basecamp 2 REST API, including stars, projects, todos, messages, and related project resources.
- Requires local credential handling, MCP tool definitions, and optional response caching.
