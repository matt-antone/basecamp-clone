## ADDED Requirements

### Requirement: List attachments in a project
The system SHALL provide a way to list attachments in a starred Basecamp project. It SHALL use Basecamp’s `GET /projects/:id/attachments.json` and SHALL support pagination (page) and optional sort. The system SHALL restrict listing to projects that are starred and allowed by configuration (same as existing project-scoped tools).

#### Scenario: List returns attachments for project
- **WHEN** a caller requests attachment list for a valid projectId (starred and allowed)
- **THEN** the system SHALL return a list of attachment records (e.g. id, name, byte_size, content_type, url if present, attachable type and id) for that project, respecting page and sort

#### Scenario: List respects project scope
- **WHEN** a caller requests attachment list for a projectId that is not starred or not allowed
- **THEN** the system SHALL return an error and SHALL NOT return attachments

#### Scenario: Linked attachments appear in list without download url
- **WHEN** the project contains linked attachments (e.g. Google Docs) that have no `url`
- **THEN** the system SHALL include them in the list with metadata (e.g. name, link_url) and SHALL NOT include a `url` for file download

### Requirement: Get single attachment metadata
The system SHALL provide a way to fetch one attachment by projectId and attachmentId. It SHALL use Basecamp’s `GET /projects/:id/attachments/:attachment_id.json` and SHALL return the attachment’s metadata (id, name, byte_size, content_type, url when present, attachable, etc.).

#### Scenario: Get returns metadata for existing attachment
- **WHEN** a caller requests metadata for a valid projectId and attachmentId the user can access
- **THEN** the system SHALL return the attachment record including `url` if the attachment is downloadable

#### Scenario: Get returns error for missing or inaccessible attachment
- **WHEN** the attachment does not exist or the user lacks access
- **THEN** the system SHALL return an appropriate error (e.g. 404 or scope/API error)

### Requirement: Download attachment file content
The system SHALL provide a way to download an attachment’s file content when the attachment has a `url`. It SHALL perform an authenticated GET to that URL and SHALL return or persist the file bytes. The system SHALL NOT attempt to download content for linked attachments (no `url`).

#### Scenario: Download returns or saves file when url present
- **WHEN** a caller requests download for an attachment that has a `url` and optionally provides a server-side path
- **THEN** the system SHALL fetch the file with auth, and SHALL either write it to the given path and return path/size/contentType, or return the content (e.g. base64) and filename/contentType when no path is given

#### Scenario: Download with path writes file to filesystem
- **WHEN** a caller requests download with a valid `downloadPath`
- **THEN** the system SHALL write the attachment’s bytes to that path and SHALL return confirmation (path, size, contentType) and SHALL NOT return full file content in the response

#### Scenario: Download without path returns content up to size limit
- **WHEN** a caller requests download without a path and the file size is within the configured or default limit for in-response content
- **THEN** the system SHALL return the file content (e.g. base64) with filename and contentType

#### Scenario: Download without path and file over size limit returns error
- **WHEN** a caller requests download without a path and the file exceeds the allowed size for in-response content
- **THEN** the system SHALL NOT return the file in the response and SHALL return a clear error instructing the caller to use a path instead

#### Scenario: Download for linked attachment returns error
- **WHEN** the attachment has no `url` (e.g. linked attachment)
- **THEN** the system SHALL NOT perform a file GET and SHALL return a clear error that the attachment is not downloadable

### Requirement: MCP tool list_attachments
The system SHALL expose an MCP tool `list_attachments` that accepts projectId and optional parameters (e.g. page, sort, attachableType, attachableId). The tool SHALL call the list-attachments capability and SHALL return the list of attachment records in the tool result.

#### Scenario: list_attachments returns project attachments
- **WHEN** an AI client calls `list_attachments` with valid projectId and optional filters
- **THEN** the system SHALL return the same attachment list (and pagination info if applicable) as the list-attachments capability

#### Scenario: list_attachments enforces project scope
- **WHEN** an AI client calls `list_attachments` with a projectId that is not starred or not allowed
- **THEN** the tool SHALL return an error consistent with other project-scoped tools

### Requirement: MCP tool download_attachment
The system SHALL expose an MCP tool `download_attachment` that accepts projectId, attachmentId, and optional downloadPath. The tool SHALL call the download capability and SHALL either write the file to downloadPath (when provided) or return file content (e.g. base64) and metadata within size limits.

#### Scenario: download_attachment with path saves file
- **WHEN** an AI client calls `download_attachment` with valid projectId, attachmentId, and downloadPath
- **THEN** the system SHALL save the file to that path and SHALL return path, size, and contentType in the tool result

#### Scenario: download_attachment without path returns content
- **WHEN** an AI client calls `download_attachment` with valid projectId and attachmentId and no path, and the file is within size limits
- **THEN** the system SHALL return file content (e.g. base64), filename, and contentType in the tool result

#### Scenario: download_attachment for linked attachment returns error
- **WHEN** the specified attachment has no `url` (linked attachment)
- **THEN** the tool SHALL return a clear error that the attachment cannot be downloaded
