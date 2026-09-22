# Local folder sync

Open a bucket or prefix, then choose **Upload > Sync local folder...**.
Choose a local folder and select **Preview changes**. The folder's contents map
directly into the displayed S3 prefix, without adding the local folder name.

The preview performs local reads and S3 LIST/HEAD requests only. It shows new,
changed, unchanged and unverified files. Remote-only objects are kept. Empty
directories do not create S3 objects. Local files are never modified or deleted.

Review the destination, then explicitly confirm replacement if existing objects
will be overwritten. Without bucket versioning, previous contents may not be
recoverable. Select **Start sync** and monitor or cancel jobs in Uploads.
Each file is independent: a failure does not roll back completed uploads.

## Comparison and limits

- Local files are streamed through Rust with bounded memory and SHA-256/MD5
  hashing. Single-part unencrypted or SSE-S3 object ETags are compared with MD5,
  together with size. Modification time alone is never treated as proof of equality.
- Multipart, KMS-encrypted or otherwise incomparable same-size objects are marked
  **Unverified**, not **Unchanged**. Accepted syncs upload them again. This first
  version does not provide checksum comparison for every S3-compatible provider.
- Up to 10,000 local files, 100 remote listing pages and 100,000 remote objects.
  Local scans are bounded to five minutes and remote listing/comparison have
  separate two-minute limits. Choose a smaller prefix if a limit is reached.
- Previews expire after 15 minutes and can only be used once. At most four
  previews are retained in memory. Changing profile/destination dismisses the UI.
- Closing the preview never starts uploads. An in-flight read-only comparison
  may finish in the background, subject to its limits.

## Write safety

Each upload first makes a temporary disk snapshot, checking SHA-256 against the
approved preview. Changed local content fails rather than uploading unreviewed
bytes. Symlinks and special files are rejected; capability-relative opens prevent
escaping the selected folder. Temporary disk space is required for concurrent
uploads and snapshots are removed when their upload finishes or is cancelled.

New keys use `If-None-Match: *`. Replacements use the previewed ETag with
`If-Match`, including multipart completion. Conflicts fail; there is no fallback
to unconditional overwrite. Providers must support these conditional operations.
Existing content type, metadata, tags, ACL grants, storage class, encryption and
object-lock attributes are preserved where supported. If required attributes
cannot be read or applied, the replacement fails safely. SSE-C objects are not
supported. ETag conditions protect content changes, not every concurrent
metadata-only edit.

Sync jobs use the existing transfer queue, speeds, cancellation, history and
retry controls. A retry retains the original content digest and destination
condition. If either side changed, create a fresh preview instead.
Editing a connection profile invalidates queued sync work. After restarting the
app, sync history is retained but retry requires a fresh preview, so old approvals
cannot be replayed against newly loaded connection settings.

This is one-way copy/update, not a mirror: no destination deletion, two-way sync,
scheduled execution, filters, or cross-profile migration are added in this change.
S3 request, storage and transfer charges still apply.

## UI implementation notes

The **Upload > Sync local folder...** action extends the existing bucket surface.
`FolderSyncDialog` reuses `BaseDialog`, the current MUI theme and
`StyledCheckbox`, with compact, fully rounded action buttons. Keep this feature
within the incumbent dialog styling; it introduces no new global design system.

The destination remains visible above the comparison. The fixed-layout preview
table wraps long object keys and displays 50 entries per page, with Previous and
Next controls when needed. Close, Preview changes (or Refresh preview) and Start
sync stay in the dialog footer. Changed and unverified objects both require
explicit replacement approval before Start sync becomes available. An empty or
fully matching folder shows a success message and leaves Start sync disabled.

Choosing another folder or refreshing the preview clears replacement approval.
The parent keys the dialog by profile, bucket and prefix, and dismisses it when
that destination changes. Async results cannot update an unmounted dialog. A
failed start clears the preview and approval so the user must compare again;
closing is blocked while uploads are being queued.

The finish review returned a ship verdict for light-theme screenshots at widths
of 1440 and 800 pixels, with no material fixes requested.
