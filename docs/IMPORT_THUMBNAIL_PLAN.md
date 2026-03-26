# Import Thumbnail Generation Plan

## Summary
Generate thumbnails during Basecamp import and store them under each project's upload folder at `/uploads/.thumbnails/`. Thumbnails must be generated for imported images as well as for PDFs. The chosen conversion approach should also cover Microsoft Office documents without requiring a second architecture later.

## Recommended Conversion System
- Use `ImageMagick` for imported images:
  - normalize image inputs into a consistent thumbnail output format such as JPG
  - support common image formats independently of Dropbox thumbnail APIs
- Use `LibreOffice` headless for Office-family documents:
  - Convert supported source files such as `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.odt`, `.ods`, and similar formats to PDF with `soffice --headless --convert-to pdf`.
- Use `pdftoppm` for PDF rasterization:
  - Render page 1 from a PDF into a thumbnail image and save it as a JPG or PNG.

### Why This System
- Covers imported images directly and stores them in the same thumbnail folder convention as other file types.
- Covers `.pdf` directly.
- Provides a practical path for Microsoft Office documents.
- Avoids relying on Dropbox preview behavior for PDFs or on Dropbox-native thumbnails as the primary source of truth.
- Avoids `unoconv` as the primary choice because the upstream repository was archived on March 31, 2025.
- Matches runtime-supported image coverage by deferring image format support to the installed ImageMagick build.

## Current Repository Findings
- Import flow lives in `lib/imports/basecamp2-import.ts`.
  - Imported files are currently recorded with `createFileMetadata(...)`.
  - The import path stores Dropbox identifiers and metadata, but does not process file content.
- Project storage naming lives in `lib/project-storage.ts`.
  - Uploads live under `<projectStorageDir>/uploads`.
  - A compatible thumbnail directory is `<projectStorageDir>/uploads/.thumbnails`.
- Current thumbnail serving lives in `app/projects/[id]/files/[fileId]/thumbnail/route.ts`.
  - It currently rejects non-image MIME types.
  - It relies on Dropbox image thumbnails or a fallback to the original image download.
- `project_files` currently stores:
  - `filename`
  - `mime_type`
  - `size_bytes`
  - `dropbox_file_id`
  - `dropbox_path`
  - `checksum`
  - optional `thread_id` and `comment_id`
- There is no thumbnail metadata column today.

## Implementation Plan

### 1. Add a Thumbnail Generation Service
- Create a server-side thumbnail service in `lib/` responsible for:
  - deciding whether a file type is thumbnailable
  - downloading the source file when needed
  - resizing and normalizing imported images into a consistent thumbnail image
  - converting Office documents to PDF when needed
  - rasterizing the first PDF page into an image
  - uploading or saving the generated thumbnail into Dropbox under the project upload tree
- Keep this service isolated from route handlers so it can be used by both import and future upload-time generation.

### 2. Use Deterministic Thumbnail Paths
- Save generated thumbnails at:
  - `<projectStorageDir>/uploads/.thumbnails/<projectFileId>.jpg`
- Generate one canonical thumbnail size only.
- Let the UI use Next.js `Image` to request responsive display sizes from that canonical source.
- This avoids a schema change in the first pass because the app can derive the thumbnail location from the file record and project storage dir.

### 3. Hook Thumbnail Generation Into Import
- In `lib/imports/basecamp2-import.ts`, after `createFileMetadata(...)` succeeds:
  - resolve the project storage dir
  - attempt thumbnail generation for supported types
  - fail the import record if thumbnail generation fails
- Thumbnail generation is part of import success criteria and must emit a clear logged error message when it fails.

### 4. Supported File-Type Behavior
- Images:
  - download the source image
  - generate a normalized thumbnail with `magick`
  - save/upload the thumbnail into `uploads/.thumbnails`
  - treat this as required behavior, not an optional later enhancement
  - support should track whatever file formats the runtime ImageMagick build supports
- PDFs:
  - download the source file
  - rasterize page 1 with `pdftoppm`
  - save/upload the thumbnail into `uploads/.thumbnails`
- Office documents:
  - download the source file
  - convert to PDF with `soffice --headless --convert-to pdf`
  - rasterize page 1 with `pdftoppm`
  - save/upload the thumbnail into `uploads/.thumbnails`
  - treat LibreOffice as a required runtime dependency for importing supported Office documents
- Unsupported file types:
  - skip thumbnail generation cleanly

### 5. Update Thumbnail Serving Route
- Update `app/projects/[id]/files/[fileId]/thumbnail/route.ts` to:
  - first check whether a saved thumbnail exists in `uploads/.thumbnails`
  - return that saved thumbnail if present
  - only use current Dropbox image thumbnail behavior as a fallback during rollout or when a legacy file has no saved thumbnail yet
- This keeps imported images, PDFs, and documents visible through the same route the UI already uses.

### 6. Logging and Failure Behavior
- Thumbnail generation failures should fail the import.
- Add import log entries or equivalent structured logging for:
  - thumbnail generated
  - thumbnail skipped because unsupported type
  - thumbnail failed with error details
- Error messages should clearly identify the file and the conversion step that failed.
- This makes retries and debugging easier while preserving strict import correctness.

## Testing Plan
- Extend `tests/integration/import-idempotency.test.ts` or add adjacent integration coverage for:
  - imported image file triggers thumbnail generation attempt
  - imported PDF file triggers thumbnail generation attempt
  - imported Office document triggers `soffice` conversion attempt
  - thumbnail generation failure fails the import with a clear error
  - rerunning the same import remains idempotent for file records and does not duplicate thumbnail work incorrectly
- Add unit tests around the new thumbnail service for:
  - file-type classification
  - image thumbnail generation command construction
  - PDF thumbnail generation command construction
  - Office-to-PDF conversion command construction
  - deterministic thumbnail path generation
  - graceful skip behavior for unsupported MIME types
- Add route tests for `app/projects/[id]/files/[fileId]/thumbnail/route.ts`:
  - serves saved thumbnail when present
  - falls back to existing image path when no saved thumbnail exists
  - continues to return unavailable for unsupported files without a saved thumbnail

## Operational Notes
- Environment check on the current machine:
  - `magick` is available
  - `pdftoppm` is available
  - `soffice` is not currently installed
  - `gs` is not currently installed
- Production or deployment environments will need `LibreOffice` installed if Office document thumbnails are required.
- Production or deployment environments must have `LibreOffice` installed for Office-document imports to succeed.
- `pdftoppm` should also be available in the runtime environment for PDF rasterization.
- `ImageMagick` should also be available in the runtime environment for image thumbnail generation.

## Assumptions and Defaults
- Thumbnails are required for supported imported file types and should fail the import job when generation fails.
- The canonical thumbnail location is under each project's `uploads/.thumbnails` folder.
- First-page thumbnails are sufficient for PDFs and Office documents.
- Image thumbnails should be generated for all imported image types we support rather than relying on Dropbox's on-demand thumbnail generation.
- Supported image types are defined by the runtime ImageMagick installation.
- No database schema change is required in phase 1 because thumbnail paths can be derived deterministically.
- Existing UI consumers should continue to use the current thumbnail route rather than accessing Dropbox thumbnail paths directly.

## Follow-up Option
- If we later want upload-time thumbnails for non-imported files too, the same service can be called from `upload-complete` so imported files and manually uploaded files behave consistently.
