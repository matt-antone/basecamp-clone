## 1. Basecamp client – attachment metadata and file fetch

- [ ] 1.1 Add `getAttachment(projectId: number, attachmentId: number)` that GETs `/projects/:id/attachments/:id.json` and returns the attachment JSON (id, name, byte_size, content_type, url, attachable, etc.)
- [ ] 1.2 Add `getAttachmentList(projectId: number, page?: number, sort?: string)` that GETs `/projects/:id/attachments.json` with optional page and sort and returns the array of attachment objects
- [ ] 1.3 Add `getAttachmentFile(url: string)` that performs an authenticated GET to the given URL (attachment’s `url`), returns response body as Buffer; use same auth header as other client requests (asset host accepts it)

## 2. Types and normalization

- [ ] 2.1 Add types for Basecamp attachment response (and attachable) in `src/basecamp/types.ts`
- [ ] 2.2 Add normalized attachment record type (e.g. for MCP) and normalizer in `src/basecamp/normalize.ts` if desired, or use raw API shape in tool output

## 3. Service – list and download

- [ ] 3.1 Add `listAttachments(projectId: number, options?: { page?: number; sort?: string; attachableType?: string; attachableId?: number })` that ensures project is starred/allowed, calls client getAttachmentList, optionally filters by attachable, returns list
- [ ] 3.2 Add `getAttachment(projectId: number, attachmentId: number)` that ensures project scope, calls client getAttachment, returns metadata
- [ ] 3.3 Add `downloadAttachment(projectId: number, attachmentId: number, options?: { downloadPath?: string; maxInMemoryBytes?: number })` that gets attachment metadata, checks for `url`, fetches file via client getAttachmentFile; if downloadPath provided writes file and returns path/size/contentType, else returns buffer (or base64) and metadata only when within maxInMemoryBytes

## 4. MCP tool – list_attachments

- [ ] 4.1 Add input/output schemas for `list_attachments` (projectId, optional page, sort, attachableType, attachableId)
- [ ] 4.2 Register `list_attachments` tool and handler that calls service listAttachments and returns the list (and any pagination info)

## 5. MCP tool – download_attachment

- [ ] 5.1 Add input/output schemas for `download_attachment` (projectId, attachmentId, optional downloadPath)
- [ ] 5.2 Register `download_attachment` tool and handler that calls service downloadAttachment; when path given return path/size/contentType, when not return base64 + filename/contentType within size limit; on linked attachment (no url) or over-size return clear error

## 6. Documentation and tests

- [ ] 6.1 Update README (and .env.example if needed) with new tools and any env (e.g. max in-memory download size)
- [ ] 6.2 Add unit tests for client getAttachment, getAttachmentList, getAttachmentFile (mocked fetch)
- [ ] 6.3 Add unit tests for service listAttachments, getAttachment, downloadAttachment (mocked client)
- [ ] 6.4 Add unit tests for list_attachments and download_attachment MCP handlers (mocked service)
- [ ] 6.5 Add or extend e2e/stdio test to cover list_attachments and download_attachment when possible (mock or real API)
