# Alternate Plan: Full Basecamp Export (With 3 Subagents)

## Review Findings On Current Plan

1. **Critical**: Completeness is not provable yet. The plan states "all available history" but lacks an explicit inclusion/exclusion matrix per resource family and status.
2. **High**: Retry/resume behavior is underspecified. There is no clear error classification, retry budget, atomic checkpoint ordering, or dead-letter strategy.
3. **High**: Validation gates are too shallow for graph exports. Counts alone are not enough without referential integrity and checksum verification.
4. **Medium**: Operational controls need more detail (per-endpoint concurrency, adaptive throttling, storage preflight, interruption semantics).
5. **Medium**: Exported-data governance is missing (output permissions, retention policy, sensitive-data handling).

## Summary

Build a dedicated CLI-based export pipeline that retrieves all visible Basecamp data across `active`, `archived`, and `trashed` projects, preserves relationships in a deterministic graph, downloads binaries when available, and supports safe resume with integrity verification.

## Subagent Execution Model (Max 3)

### Subagent A: Traversal + Contracts
- **Ownership**: Scope contract, endpoint map, status coverage, pagination traversal, canonical IDs.
- **Suggested skills**:
  - `find-skills` (to discover any repo-local export/API traversal helpers)
- **Primary deliverables**:
  - Inclusion/exclusion matrix by resource type and status
  - Canonical ID and schema-version rules
  - Deterministic traversal spec and fetch adapters

### Subagent B: Manifest + Files
- **Ownership**: Graph node/edge writers, manifest format, file downloader, hashing/deduplication.
- **Suggested skills**:
  - `find-skills` (optional, for file pipeline helpers)
- **Primary deliverables**:
  - `nodes.ndjson`, `edges.ndjson`, `manifest.json`
  - Content-addressed file store
  - Metadata-only representation for external links

### Subagent C: Resilience + Validation
- **Ownership**: Retry taxonomy, checkpoint/resume, integrity checks, test gates, runbook.
- **Suggested skills**:
  - `security-best-practices` (for export-data handling, filesystem controls, retention guidance)
  - `find-skills` (optional, for test/validation helpers)
- **Primary deliverables**:
  - Retry/backoff policy by error class (`429`, `5xx`, network, non-retryable `4xx`)
  - Atomic resume rules and failure manifests
  - Go/no-go validation checklist

## Phased Plan

### Phase 0: Export Contract and Boundaries
- Define explicit endpoint coverage matrix: `included`, `excluded`, `reason`.
- Define canonical IDs, manifest schema version, dedupe/upsert behavior.
- Define output directory structure and naming.
- **Gate**: Contract document approved and fixture dataset chosen.

### Phase 1: Core Discovery and Traversal
- Add `export` CLI (`npm run export -- --statuses active,archived,trashed --output <dir> --resume`).
- Implement status-aware project discovery and link-header pagination until exhaustion.
- Traverse record types (recordings, comments, docs, todos, uploads, people) with preserved source identifiers.
- **Gate**: Deterministic node/edge generation on fixture data.

### Phase 2: Graph + Binary Pipeline
- Write normalized graph artifacts:
  - Nodes: `project`, `recording`, `message`, `comment`, `document`, `upload`, `vault`, `todo`, `todolist`, `person`
  - Edges: `IN_PROJECT`, `PARENT_OF`, `COMMENTS_ON`, `CREATED_BY`, `HAS_FILE`, `IN_VAULT`
- Download binaries for downloadable files; store external links as metadata-only.
- Hash and dedupe file content; map each file to parent records in manifest.
- **Gate**: Stable manifest and checksum pass for fixture run.

### Phase 3: Reliability and Resume
- Implement retry policy with jitter and bounded attempts by error class.
- Implement atomic checkpoint rule: write artifact first, then advance cursor.
- Persist failed fetches/downloads to a retry/dead-letter report.
- Add adaptive concurrency controls and per-endpoint caps.
- **Gate**: Forced-interruption recovery drill without graph corruption.

### Phase 4: Verification and Hardening
- Add validation gates:
  - Referential integrity (`all edges resolve`)
  - File integrity (`hash/size matches manifest`)
  - Completeness reconciliation (expected vs exported counts by type/status)
  - Run fail thresholds (for example, missing binaries above configured threshold)
- Add retention and permission guidance for export artifacts.
- Publish operational runbook (start, resume, recovery, verification).
- **Gate**: End-to-end signoff checklist passes.

## Interfaces and Configuration

- New command: `export`
- New environment/config options:
  - `BASECAMP_EXPORT_OUTPUT_DIR`
  - `BASECAMP_EXPORT_MAX_CONCURRENCY`
  - `BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS`
  - `BASECAMP_EXPORT_INCLUDE_STATUSES` (default `active,archived,trashed`)
- Existing MCP query tools remain unchanged for backward compatibility.

## Test Plan

- **Unit**:
  - Link-header pagination traversal
  - Status-filtered project enumeration
  - Canonical relationship mapping
  - Downloadable vs metadata-only file behavior
- **Integration**:
  - Multi-project export graph correctness
  - Resume after interruption with idempotent outputs
  - Deduped file writes + manifest consistency
- **E2E**:
  - CLI dry run and full run validation over generated artifacts
  - Recovery drill (interrupt + resume)
  - Threshold-based failure behavior

## Assumptions

- Export includes `active`, `archived`, and `trashed` data.
- Export depth is all data available through traversed APIs.
- Linked external files are metadata-only; downloadable files are stored locally.
- This export pipeline is parallel to existing starred-project MCP query tools.
