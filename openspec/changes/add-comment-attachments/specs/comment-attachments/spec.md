## ADDED Requirements

### Requirement: Attachment upload obtains a token from Basecamp
The system SHALL upload file binary to Basecamp’s attachment endpoint (`POST /attachments.json`) with appropriate `Content-Type` and `Content-Length` headers and SHALL use the returned token when creating a comment that includes that attachment.

#### Scenario: Successful upload returns token
- **WHEN** the client uploads a file to the Basecamp attachments endpoint with valid auth and body
- **THEN** the API returns a token and the system SHALL use that token in a subsequent comment creation request

#### Scenario: Upload failure prevents comment creation
- **WHEN** any attachment upload fails (e.g., network error, 4xx/5xx from Basecamp)
- **THEN** the system SHALL NOT create the comment and SHALL return a clear error to the caller

### Requirement: post_comment accepts optional file attachments
The system SHALL extend the `post_comment` MCP tool to accept an optional list of attachment inputs (e.g., file paths). The tool SHALL upload each file to Basecamp, collect tokens and filenames, and SHALL include them in the comment creation payload as an `attachments` array of `{ token, name }` where `name` is a valid filename with extension.

#### Scenario: Comment is created with one or more attachments
- **WHEN** an AI client calls `post_comment` with valid `projectId`, `messageId`, `content`, and one or more attachment inputs (e.g., file paths)
- **THEN** the system SHALL upload each file, create the comment with the returned tokens and names, and SHALL return the created comment result

#### Scenario: Comment without attachments is unchanged
- **WHEN** an AI client calls `post_comment` without any attachment inputs
- **THEN** the system SHALL create the comment with only content (and any subscribers/newSubscriberEmails) as today

#### Scenario: Invalid or unreadable attachment path returns error
- **WHEN** an attachment input refers to a path that does not exist or is not readable by the server
- **THEN** the system SHALL NOT create the comment and SHALL return a clear validation or I/O error to the caller
