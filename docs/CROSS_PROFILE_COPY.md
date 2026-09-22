# Copy between profiles

Select files or folders, Copy, switch to another profile, open the destination folder, and Paste. Review the source and destination in the confirmation before selecting **Copy to destination**. Existing same-profile copy and move remain unchanged. Cut is cleared when switching profiles; cross-profile moves are not supported.

## Transfer behavior

- Rust resolves source and destination clients independently. No server-side copy assumes that different providers share credentials or storage.
- All selected folders are enumerated and source objects inspected before any jobs are queued. Listing and inspection are bounded to 120 seconds and 10,000 objects, after profile and client initialization. Individual listings retain the existing page/object limits.
- Source content is read with its captured ETag using `If-Match`. A changed, missing or unreadable source fails the object without uploading it.
- One private temporary file per active copy holds the downloaded object. Memory usage is streamed. Allow sufficient temporary disk space for the active copies. Temporary files are removed on ordinary completion, error or cancellation; an abrupt process or machine crash may leave operating-system temporary files.
- Destination PUT and multipart completion use `If-None-Match: *`. Existing destination objects produce failed transfers, never an unconditional replacement. Compatible providers must honor conditional writes.
- Contents, content type, cache control, content disposition, content encoding, content language and user metadata are copied. Tags, ACLs, version history, website redirects, expiration, retention, source encryption keys and source storage classes are not copied. The destination's defaults apply. This is a content copy, not a complete backup or compliance migration.
- SSE-C objects are rejected. Archived objects that cannot be read must be restored outside this flow first.
- Folders retain their selected folder name and relative object keys, including explicit folder-marker objects. Duplicate mappings from different source objects fail preparation instead of silently choosing one. Empty virtual folders contain nothing to copy.
- Uploads lists grouped cross-profile copies. Total/progress count both legs, so a 10 MB object transfers 20 MB through this computer. The source-to-temporary stage occupies the first half and the upload stage the second. Network speed reflects the active leg.
- Cancellation uses existing transfer controls. Multipart cancellation waits for the current request and aborts its upload. Completed copies remain; there is no batch rollback. A cancellation racing with a successful final server response can leave a completed destination object; inspect it before retrying.
- Retry retains the captured source and create-only destination guard. After an app restart, copy the selection again. Editing or removing a profile before a queued job starts fails that job; active jobs retain their captured clients. Environment/shared-config credentials can still change outside the application.
- S3 requests, source egress and destination storage can incur provider charges. The app must remain running for copies to complete.

## Validation

Automated tests cover key mapping, source identity/size validation, independent endpoints, portable metadata, create-only requests, source changes, cancellation, temporary-file cleanup, restart/retry safety, confirmation and keyboard clipboard navigation. The opt-in `cross_profile_real_endpoints_round_trip_and_conflicts` test uses two disposable S3 endpoints with different credentials, covering zero-byte, small and multipart copies and destination/source conflicts. It must never target production buckets.

AWS documents [conditional destination writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). Provider capabilities differ; see [Cloudflare R2 compatibility](https://developers.cloudflare.com/r2/api/s3/api/). No universal provider or network-failure guarantee is implied.

## UI implementation notes

The confirmation extends the existing MUI theme and `BaseDialog`, retaining its full-width, small dialog layout and footer. Source profile and destination profile plus exact S3 path appear first, followed by the selection count, up to five object paths, and any remaining count. Long names and paths wrap. Transfer safeguards and metadata limitations remain visible before confirmation. Both footer buttons use compact sizing and fully rounded corners (`999px`); Cancel uses `text.primary`, and Copy to destination is the contained primary action.

While preparation is busy, a progress indicator and status message explain source checking and queueing. Both actions, the close icon, Escape, and backdrop dismissal are disabled through `BaseDialog.closeDisabled`; a pending guard prevents duplicate submissions. Preparation errors appear inline and allow retry. Missing source or destination profiles show recovery guidance and disable copying. Successful preparation closes the dialog and reports the queued count, or that selected folders contained no objects; ongoing progress and cancellation live in Uploads.

The bucket page captures the clipboard selection with a destination view key containing profile, bucket, region, and prefix. It mounts the dialog only while that key matches the current destination and clears the confirmation when the destination changes, preventing stale confirmation from targeting a newly opened location.

The finish review returned **ship** after resolving its sole material finding: Cancel text contrast, corrected with `text.primary`. Review covered light-theme captures at 1440px and 800px; those development-only captures are not distributed with the repository. These notes describe this surface only; the existing application design system remains the visual authority.
