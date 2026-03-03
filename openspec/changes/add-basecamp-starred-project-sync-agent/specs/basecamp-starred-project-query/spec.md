## ADDED Requirements

### Requirement: Starred projects define default project scope
The system SHALL refresh the authenticated user’s Basecamp starred projects and SHALL treat those project IDs as the default scope for project-scoped MCP tools.

#### Scenario: Starred project is available to project-scoped tools
- **WHEN** an MCP tool requests project-scoped data and the project is currently returned by the user’s stars list
- **THEN** the server allows the request to query that project

#### Scenario: Unstarred project is excluded by default
- **WHEN** an MCP tool requests project-scoped data for a project that is not currently starred by the user
- **THEN** the server rejects or omits that project from the response by default

### Requirement: Query responses are normalized for AI use
The system SHALL transform Basecamp project, todo, message, document, and activity data into stable, tool-specific response shapes rather than returning raw upstream payloads.

#### Scenario: Starred project listing is normalized
- **WHEN** an AI client calls the tool for starred projects
- **THEN** the response includes consistent project identifiers, names, and metadata needed for follow-up queries

#### Scenario: Recent activity is normalized
- **WHEN** an AI client calls the tool for recent project activity
- **THEN** the response includes consistent actor, action, project, and timestamp fields for each returned item

### Requirement: Tool-level filters narrow results without widening project scope
The system SHALL support query filters such as timeframe, assignee, and event type while preserving starred-project scope by default.

#### Scenario: Activity query uses a timeframe filter
- **WHEN** an AI client requests recent project activity with a specific timeframe
- **THEN** the server returns only matching activity within the starred-project scope

#### Scenario: Todo query uses an assignee filter
- **WHEN** an AI client requests todos with an assignee filter
- **THEN** the server returns only todos matching that assignee within the allowed project scope
