## Context

This change introduces a local MCP server rather than a background sync process or hosted service. The server must let AI query Basecamp 2 on demand without exposing irrelevant project noise, so starred projects become the default project-level scope. The primary product constraint is signal quality: AI should only see the projects the user has explicitly starred unless the server is intentionally reconfigured. The primary technical constraints are Basecamp 2 rate limits, required `User-Agent` headers, predictable MCP tool behavior, and returning structured data that is useful to AI clients without over-fetching. The initial transport target is local `stdio`; HTTP remains a later extension point and should not shape the first implementation.

## Goals / Non-Goals

**Goals:**
- Run as a local Basecamp 2 MCP server that AI clients can connect to on demand.
- Use `stdio` as the first MCP transport so local clients can spawn the server directly.
- Use Basecamp starred projects as the default project-level inclusion source of truth.
- Expose focused tools for listing starred projects, reading project activity, retrieving the user’s todos, and viewing relevant project content.
- Return normalized, structured Basecamp data that AI can reason over without needing raw API fan-out.
- Provide simple local configuration for credentials, account selection, and optional caching or scope overrides.

**Non-Goals:**
- Building a full interactive Basecamp client or GUI in this change.
- Running a background daemon that automatically writes Basecamp data into Open Brain.
- Supporting multi-user tenancy or hosted deployment.
- Replacing Basecamp as the source of truth for project organization or starring.
- Exposing every Basecamp endpoint before there is a concrete AI use case.
- Building or hardening an HTTP transport in the first implementation pass.

## Decisions

### Use a local MCP server, not a background sync agent

The primary user need is AI-readable access to relevant Basecamp context, not automatic ingestion. A local MCP server satisfies that need directly by letting AI request Basecamp data only when needed, which avoids generating low-signal Open Brain writes and removes most background lifecycle complexity.

Alternatives considered:
- Background sync agent: rejected for the first version because it adds noise management, persistence, and startup complexity before proving query value.
- Hosted deployment: rejected because the user prefers a local server and does not need a stronger security or multi-user model.

### Start with stdio transport and keep HTTP optional

The first implementation will use MCP over `stdio`, letting local AI clients spawn the server process directly. This keeps setup simple, avoids port and auth concerns, and reduces compatibility work while the Basecamp tool surface is still being defined. The transport boundary must remain isolated so an HTTP adapter can be added later without changing Basecamp query logic or tool contracts.

Alternatives considered:
- HTTP-first transport: rejected because it adds operational surface area that is unnecessary for the local single-user workflow.
- Mixing stdio and HTTP in v1: rejected because it increases testing and compatibility scope before the core tool set is stable.

### Use Basecamp stars as the primary allowlist

The server will refresh the authenticated user’s starred projects and treat those project IDs as the only projects accessible to project-scoped tools by default. This keeps project relevance under user control in Basecamp and avoids introducing a separate project-selection UI or duplicated preference store.

Alternatives considered:
- Static local project allowlist: rejected because it drifts from the user’s live Basecamp workflow.
- Expose all projects and rely on prompt discipline: rejected because the default needs to stay low-noise.

### Expose opinionated MCP tools instead of a generic REST passthrough

The server will offer a small set of high-value tools such as listing starred projects, fetching recent activity for a starred project, fetching the authenticated user’s open todos, and retrieving recent messages or documents from a starred project. This gives AI stable interfaces and avoids forcing every client to understand the full Basecamp REST surface.

Alternatives considered:
- Raw HTTP proxy tool: rejected because it would leak too much irrelevant surface area and make prompts responsible for correctness.
- Full endpoint parity: rejected because it expands scope without improving the initial user experience.

### Use lightweight caching rather than sync-state persistence

The server does not need durable sync cursors because it is query-driven. It may keep a small in-memory or file-backed TTL cache for frequently requested data such as the starred project list or recent activity responses, but it should remain correct without persistent synchronization state.

Alternatives considered:
- SQLite sync state: rejected because there is no ingestion pipeline to checkpoint.
- No caching at all: acceptable initially, but a small cache is preferable to reduce repetitive API calls during an AI session.

### Normalize Basecamp responses at the adapter boundary

The Basecamp adapter should map Basecamp 2 resources into stable, tool-specific response shapes before they reach MCP handlers. This keeps the handlers thin, prevents leaking inconsistent upstream payloads to AI clients, and makes tests resilient to incidental API fields.

Alternatives considered:
- Returning raw Basecamp JSON: rejected because it pushes normalization and relevance interpretation into every AI client.
- Per-tool bespoke API calls without a shared adapter layer: rejected because auth, retry, and shape normalization would fragment quickly.

### Keep security simple and local

The server will use local Basecamp credentials from an uncommitted environment file or shell environment. Because this is a local-only tool for a single user, strong multi-tenant controls and hosted secret-management flows are out of scope for the first version.

Alternatives considered:
- Hosted secret management: rejected because the user does not need hosted deployment or stronger operational controls for v1.
- Plaintext committed config: rejected because local and simple does not require checking secrets into the repo.

## Risks / Trade-offs

- [Some Basecamp endpoints may not align perfectly with high-level AI queries] -> Mitigation: start with a narrow tool set and normalize responses around concrete user questions.
- [Starred projects alone may still be too broad for some queries] -> Mitigation: allow tool-level filters for assignee, timeframe, and event type while preserving starred-only project scope by default.
- [Repeated AI queries could hit rate limits] -> Mitigation: use a short TTL cache, respect `Retry-After`, and keep tool calls coarse enough to avoid API fan-out.
- [Returning raw Basecamp payloads could make AI behavior inconsistent] -> Mitigation: define stable MCP response schemas and keep normalization centralized.
- [Local credential handling is intentionally lightweight] -> Mitigation: keep secrets out of git and prefer environment-based configuration.

## Migration Plan

1. Introduce the MCP server project structure, tool registration, and local configuration.
2. Implement the `stdio` transport entrypoint and keep transport wiring isolated from Basecamp logic.
3. Implement Basecamp authentication, starred-project discovery, and normalized query adapters.
4. Implement the initial MCP tool set and response schemas with tests.
5. Add optional lightweight caching and developer documentation for local usage.

Rollback strategy:
- Stop the local MCP server and remove local credentials or configuration.
- Remove the local package without requiring any Basecamp-side changes.

## Open Questions

- Which initial tool set is the minimum useful surface: starred projects plus my todos, or do we also include project activity and messages in v1?
- Do we want a dedicated save-to-Open-Brain helper tool later, or should that remain outside this server entirely?
