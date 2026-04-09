## Why

Basecamp allows commenters to attach files when posting; the current MCP `post_comment` tool only supports plain text. Adding attachment support lets AI-assisted workflows attach screenshots, documents, or other files to comments (e.g., "post this PDF to the thread and notify the client"), matching how users post manually.

## What Changes

- Extend the Basecamp 2 comment-creation flow to support file attachments.
- Add a way for the MCP to upload file content to Basecamp and receive attachment tokens.
- Extend the `post_comment` MCP tool to accept optional attachments (e.g., by path or inline content) and include them in the comment payload using Basecamp’s attachment API.

## Capabilities

### New Capabilities
- `comment-attachments`: Support attaching files when posting a comment. Covers the Basecamp attachment upload flow (create attachment, obtain token), and extending `post_comment` so callers can supply attachments that are uploaded and then included in the comment.

### Modified Capabilities

None.

## Impact

- **Basecamp client**: New method(s) to create attachments (POST to Basecamp attachments endpoint) and existing `postComment` updated to accept and send attachment tokens.
- **MCP tool `post_comment`**: New optional parameter(s) for attachments (e.g., file paths or content references). Tool implementation coordinates upload then comment creation.
- **Dependencies**: No new runtime dependencies. Uses existing Basecamp 2 APIs (attachments + comments with `attachments` array).
