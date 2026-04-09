## 1. Basecamp client – attachment upload

- [x] 1.1 Add `postBinary(path, body: Buffer, contentType: string)` (or equivalent) to BasecampClient to send raw body with Content-Type and Content-Length
- [x] 1.2 Add `createAttachment(fileContent: Buffer, contentType: string)` that POSTs to `/attachments.json` and returns the token from the JSON response

## 2. Service – upload and comment with attachments

- [x] 2.1 Add helper to resolve MIME type from filename (extension → Content-Type map; fallback to application/octet-stream)
- [x] 2.2 Add `uploadAttachment(filePath: string)` (or accept buffer + filename) that reads file, calls client createAttachment, returns `{ token, name }`; throw clear error if file missing/unreadable
- [x] 2.3 Extend `postComment` to accept optional `attachments?: Array<{ filePath: string }>` (or similar); for each item, upload then collect `{ token, name }`; include `attachments` array in comment POST body when non-empty
- [x] 2.4 Ensure comment is not created if any upload fails; return clear error to caller

## 3. MCP tool – post_comment with attachments

- [x] 3.1 Extend `postCommentInputSchema` with optional `attachmentPaths?: string[]` (array of file paths)
- [x] 3.2 Update `post_comment` handler to pass attachment paths to service and surface upload/validation errors
- [x] 3.3 Update README and tool description for optional attachments

## 4. Verification

- [x] 4.1 Add unit tests for attachment upload (mocked client) and for postComment with attachments
- [x] 4.2 Add or extend e2e/test to cover post_comment with attachment paths when possible
