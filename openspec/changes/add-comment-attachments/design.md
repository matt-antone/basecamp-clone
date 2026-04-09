## Context

The Basecamp 2 API supports attaching files to comments in two steps: (1) upload file binary to `POST /attachments.json` and receive a `token`; (2) create the comment with an `attachments` array of `{ token, name }` (name must be a valid filename with extension). The current MCP server has a read-only Basecamp client plus `postComment` that sends only `content` (and optional `subscribers` / `new_subscriber_emails`). There is no attachment upload path today.

## Goals / Non-Goals

**Goals:**
- Allow `post_comment` callers to attach one or more files to a comment.
- Use the official two-step flow (upload → token, then comment with tokens) so behavior matches Basecamp’s expectations.
- Keep the MCP tool contract simple: e.g., accept a list of file paths (or content + filename) that the server reads and uploads.

**Non-Goals:**
- Supporting linked attachments (e.g., Google Docs) or other non-upload attachment types.
- Adding a separate “upload only” MCP tool; attachments are created in the context of posting a comment.
- Changing how existing comment parameters (content, subscribers, newSubscriberEmails) work.

## Decisions

**1. How callers supply files: file paths vs. inline content**

- **Chosen:** Accept **file paths** (strings) relative to the MCP server’s working directory or absolute. The server reads each file from disk and uploads its binary to Basecamp.
- **Rationale:** MCP tools are typically invoked by an agent that has access to the workspace; paths (e.g., to a generated screenshot or document) are easy to pass. Inline base64/content would bloat tool payloads and require size limits.
- **Alternative considered:** Inline base64 or URL. Rejected for first version to avoid payload size and URL-fetch complexity; can be added later if needed.

**2. Where upload and comment creation run**

- **Chosen:** Implement in the **same process** as the rest of the MCP server: client method for `POST /attachments.json` (binary body), then `postComment` (or equivalent) extended to accept attachment tokens and pass them in the comment body. The tool handler (1) uploads each file in order, (2) collects tokens and filenames, (3) calls the existing comment-creation path with `attachments: [{ token, name }, ...]`.
- **Rationale:** Keeps a single Basecamp client and auth context; no new services or out-of-process upload step.

**3. Content-Type and filename for uploads**

- **Chosen:** For each file path, derive `Content-Type` from the file extension (e.g., a small map of extension → MIME type) and use the file’s basename as `name` when attaching to the comment. If the filename has no extension, use a generic type (e.g., `application/octet-stream`) and still send a name (Basecamp requires a valid filename with extension; we can append a default like `.bin` if necessary).
- **Rationale:** Basecamp expects `Content-Type` and `Content-Length` on the upload; the comment API requires `name` to be a valid filename with extension. Using the real filename keeps attachments recognizable in the UI.

**4. Error handling when one of several uploads fails**

- **Chosen:** If any upload fails, do **not** create the comment. Return a clear error to the caller (e.g., “attachment upload failed: …”). Optionally, after a failed upload, avoid leaving orphan tokens by not retrying comment creation with a partial list.
- **Rationale:** Partial comments (some attachments missing) would be confusing; failing fast keeps behavior predictable.

## Risks / Trade-offs

- **Large files:** Basecamp’s docs note that big uploads can take a long time. The MCP server may need to allow longer timeouts or streaming for large bodies. Mitigation: document recommended max file size; consider a configurable limit and clear error if exceeded.
- **Path safety:** Accepting file paths means the server can read any file it has read access to. Mitigation: restrict to paths under the workspace or an explicit allowlist if the server runs in a shared environment; document that paths are resolved by the server process.
- **No rollback of uploads:** If the comment creation fails after uploads succeed, the tokens are already created on Basecamp’s side. Mitigation: accept this; Basecamp may garbage-collect unused tokens. No need to implement token deletion for this change.
