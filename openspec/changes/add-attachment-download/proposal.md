## Why

Files attached to messages (discussions), to-dos, uploads, and comments in Basecamp are currently visible only as counts in the MCP (e.g. `attachments: 2`). There is no way for an AI or integration to list those attachments or download their contents. Adding list and download support lets workflows fetch files from a thread, save them locally, or pass them to other tools (e.g. "download the PDFs attached to this discussion").

## What Changes

- Add the ability to list attachments in a starred project (with optional filtering by attachable type or id).
- Add the ability to fetch a single attachment’s metadata and to download its file content (for attachments that have a `url`; linked attachments like Google Docs are out of scope for download).
- Expose these as MCP tools so callers can list attachments and download files (e.g. to a path or as base64).

## Capabilities

### New Capabilities
- `attachment-download`: List attachments in a project (with optional filters) and download attachment file content by ID. Covers Basecamp `GET /projects/:id/attachments.json`, `GET /projects/:id/attachments/:id.json`, and authenticated GET to the attachment’s `url` for file bytes; MCP tools to list and download.

### Modified Capabilities

None.

## Impact

- **Basecamp client**: New methods to get attachment metadata (single and list) and to perform an authenticated GET for attachment file URL (binary response).
- **Service**: New methods to list project attachments and to download an attachment’s file (returning buffer and filename/content-type).
- **MCP tools**: New `list_attachments` (projectId, optional filters) and `download_attachment` (projectId, attachmentId, optional save path or return format).
- **Dependencies**: No new runtime dependencies; uses existing Basecamp 2 APIs (attachments list, single attachment, and attachment `url` with same auth).
