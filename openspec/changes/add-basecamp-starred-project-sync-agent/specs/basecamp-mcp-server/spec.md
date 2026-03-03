## ADDED Requirements

### Requirement: MCP server exposes high-value Basecamp tools
The system SHALL provide MCP tools for listing starred projects, retrieving recent project activity, retrieving the authenticated user’s open todos, and reading recent project messages or documents.

#### Scenario: AI client lists starred projects
- **WHEN** an AI client calls the starred-project listing tool
- **THEN** the server returns the authenticated user’s starred projects in the normalized project shape

#### Scenario: AI client retrieves open todos
- **WHEN** an AI client calls the open-todos tool
- **THEN** the server returns the authenticated user’s open todos across the allowed project scope

### Requirement: MCP tools handle Basecamp operational errors consistently
The system SHALL apply consistent error handling for authentication failures, rate limits, invalid tool arguments, and unavailable Basecamp resources.

#### Scenario: Rate-limited request returns a structured MCP error
- **WHEN** Basecamp responds with a rate-limit status for a tool request
- **THEN** the MCP tool returns a structured error that indicates the request was rate-limited

#### Scenario: Invalid project argument is rejected
- **WHEN** an AI client provides an invalid or out-of-scope project identifier to a project-scoped tool
- **THEN** the MCP tool rejects the request with a validation error

### Requirement: Local configuration is sufficient to run the server
The system SHALL run locally with Basecamp credentials and account configuration supplied through local environment-based configuration without requiring hosted infrastructure.

#### Scenario: Server starts with local configuration
- **WHEN** the required Basecamp account and credential settings are present in the local environment
- **THEN** the MCP server starts successfully and registers its tools

#### Scenario: Missing credentials prevent startup
- **WHEN** the required Basecamp credentials are absent
- **THEN** the server fails fast with a clear startup error describing the missing configuration
