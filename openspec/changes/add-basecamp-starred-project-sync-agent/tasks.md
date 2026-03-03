## 1. Project Setup

- [x] 1.1 Initialize the local MCP server project structure and package configuration for a TypeScript/Node implementation.
- [x] 1.2 Add local configuration loading for Basecamp account ID, credentials, optional cache settings, and tool defaults.
- [x] 1.3 Register the MCP `stdio` transport, tool definitions, and shared response schemas.

## 2. Transport Boundary

- [x] 2.1 Implement the `stdio` MCP server entrypoint so local clients can spawn the server directly.
- [x] 2.2 Keep transport wiring isolated from Basecamp query logic so HTTP can be added later without reshaping tool handlers.

## 3. Basecamp Query Layer

- [x] 3.1 Implement the Basecamp API client with required headers, authentication, retry handling, and rate-limit backoff.
- [x] 3.2 Implement starred-project discovery that produces the default project allowlist for project-scoped tools.
- [x] 3.3 Implement shared adapters that normalize Basecamp projects, todos, messages, documents, and recent activity into stable tool response shapes.

## 4. MCP Tools

- [x] 4.1 Implement a tool to list the user’s starred projects and basic project metadata.
- [x] 4.2 Implement tools for querying recent activity and recent messages or documents within starred projects.
- [x] 4.3 Implement a tool for querying the authenticated user’s open todos across starred projects.
- [x] 4.4 Implement optional tool-level filters for project ID, timeframe, assignee, and event type without widening default project scope.

## 5. Local Runtime And Documentation

- [x] 5.1 Add lightweight caching for repeated starred-project and recent-query requests.
- [x] 5.2 Add basic local-secret handling guidance using environment variables or an uncommitted env file.
- [x] 5.3 Document how to run the MCP server locally over `stdio` and note HTTP as a later extension.

## 6. Verification

- [x] 6.1 Add tests for starred-project scoping, response normalization, and rate-limit handling in the Basecamp query layer.
- [x] 6.2 Add tests for each MCP tool’s validation, filtering behavior, and output schema.
- [x] 6.3 Add an end-to-end validation path that exercises the `stdio` MCP server against mocked Basecamp responses.
