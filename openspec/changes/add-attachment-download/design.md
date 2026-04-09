## Context

The Basecamp 2 API exposes attachments via `GET /projects/:id/attachments.json` (paginated list) and `GET /projects/:id/attachments/:attachment_id.json` (single attachment). Each attachment object includes a `url` (on asset host, e.g. asset1.basecamp.com) that returns the file bytes when requested with the same auth. Linked attachments (e.g. Google Docs) have no `url` and include `link_url` / `linked_source` instead; downloading those is out of scope. The current MCP server has no attachment list or download path; messages and topics only expose an `attachments` count.

## Goals / Non-Goals

**Goals:**
- Allow callers to list attachments in a starred project, with optional filtering (e.g. by attachable type or id).
- Allow callers to fetch one attachment’s metadata and to download its file content when the attachment has a `url`.
- Expose list and download as MCP tools so agents can list then download by id, or save to a path.

**Non-Goals:**
- Downloading or “opening” linked attachments (Google Docs, etc.); only attachments with a `url` are downloadable.
- Changing existing MCP tools or response shapes beyond adding new tools.
- Supporting unauthenticated or different-auth download URLs.

## Decisions

**1. Where to perform the file GET (attachment `url`)**

- **Chosen:** The Basecamp client performs an authenticated GET to the attachment’s `url` (asset host). Reuse the same auth (Basic or Bearer) as other requests; Basecamp’s asset URLs accept it.
- **Rationale:** Keeps auth and retry logic in one place; no separate “download service.” Alternative of returning the URL to the client would require the MCP caller to re-authenticate and is less useful for automation.

**2. How the MCP tool returns downloaded file content**

- **Chosen:** Support both (a) saving to a server-side path (e.g. `downloadPath`), and (b) returning content in the tool result (e.g. base64) for small files or when no path is given. If a path is provided, write the file and return metadata (path, size, contentType); otherwise return base64 (and optionally filename/contentType) so the caller can persist or forward it.
- **Rationale:** Agents may want “save to workspace” (path) or “give me the bytes” (base64). Document a reasonable size limit for base64-in-response to avoid huge payloads; above that, require a path or return an error.

**3. Pagination and filtering for list**

- **Chosen:** List uses Basecamp’s `GET /projects/:id/attachments.json` with `page` and optional `sort`. Expose `projectId`, optional `page`, optional `sort`, and optional filters (e.g. attachable type or attachable id) in the MCP tool. If the API supports filter query params, use them; otherwise fetch pages and filter in the service layer.
- **Rationale:** Basecamp returns 50 per page and supports `sort` (name, size, age). Filtering by attachable (e.g. “attachments for this message”) can be done client-side by filtering the list response on `attachable.id` / `attachable.type` if the API doesn’t support it, keeping the first version simple.

**4. Error handling for missing or linked attachments**

- **Chosen:** If the attachment has no `url` (linked attachment), the download tool SHALL return a clear error and SHALL NOT attempt to fetch from `link_url`. If the attachment id or project is invalid or the user lacks access, return the same style of API/scope errors as existing tools.
- **Rationale:** Prevents confusing failures and makes “not downloadable” explicit.

## Risks / Trade-offs

- **Large files / timeouts:** Downloading very large files may hit response size or timeout limits when returning base64. Mitigation: enforce a max size for base64 return (e.g. 5–10 MB); above that, require `downloadPath` or return an error with guidance.
- **Asset URL auth:** If asset host ever requires different auth, the current approach would break. Mitigation: none for now; Basecamp 2 has used same auth. Document that download uses the same credentials as the rest of the client.
- **Listing all attachments in huge projects:** Listing without filters could return many pages. Mitigation: document default page size and optional filters; consider a low default limit (e.g. one page) for list_attachments if needed.

## Migration Plan

No migration. New client/service methods and new MCP tools only; no changes to existing APIs or stored data. Deploy as usual; no rollback beyond reverting the change.

## Open Questions

- None for initial implementation. Optional later: allow filtering list by attachable type/id via Basecamp query params if the API supports them.
