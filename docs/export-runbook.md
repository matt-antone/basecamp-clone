# Basecamp Export Runbook

## Purpose
This runbook defines safe operation of the full export pipeline for active, archived, and trashed Basecamp data.

## Start
1. Set required auth environment variables (`BASECAMP_ACCOUNT_ID`, auth credentials/token).
2. Optionally set export controls:
   - `BASECAMP_EXPORT_OUTPUT_DIR`
   - `BASECAMP_EXPORT_MAX_CONCURRENCY`
   - `BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS`
   - `BASECAMP_EXPORT_INCLUDE_STATUSES`
3. Start an export run with explicit output path and statuses.

## Resume
1. Re-run the export with `--resume` against the same output directory.
2. The checkpoint file is read first.
3. Work is skipped for resource keys already marked complete.
4. Checkpoint updates are atomic (`*.tmp` then rename) to avoid partial-state corruption.

## Recovery
1. If interrupted, do not delete artifacts.
2. Verify `checkpoint.json` is valid JSON.
3. Re-run with `--resume`.
4. If checkpoint is corrupt, archive it, restore from backup if available, and re-run.

## Validation Gates
Every run must pass these checks:
1. Referential integrity: all edge endpoints resolve to existing node IDs.
2. File integrity: downloaded files must match manifest hash and size.
3. Completeness reconciliation: expected and actual counts must match by `type:status`.
4. Missing files threshold: fail if missing downloadable files exceed configured threshold.

## Data Governance
1. Store export artifacts with least-privilege filesystem permissions.
2. Keep exports in a dedicated directory isolated from source repositories.
3. Retain only required snapshots; remove stale exports after compliance window.
4. Treat exports as sensitive data and avoid syncing to unsecured storage.
