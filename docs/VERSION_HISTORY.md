# Object version history and restore

Version history inspects one exact object key and restores an older data version by creating a new current version at that key. Restoring never deletes historical versions or delete markers. It does not enable bucket versioning automatically.

## Workflow

1. Open **Version history** from a file's context menu or the bucket toolbar. The toolbar also finds deleted objects that are absent from ordinary browsing. With one selected key it starts there; otherwise it starts with the current folder prefix.
2. Enter the full **Exact object key**, including folders, and choose **Load history** or press Enter. Keys are case-sensitive and must contain 1 to 1,024 bytes. This is an exact lookup, not a folder or prefix history search. A supplied file key loads automatically; a folder prefix does not.
3. Inspect the version ID, state, modification time and size. States distinguish **Current**, **Older version**, **Current deletion** and **Delete marker**. Delete markers have no content size. Missing or invalid dates show **Not provided**.
4. Use **Previous** and **Next** to inspect history. Requests ask for up to 100 entries per page, with a maximum of 100 loaded pages. Nearby keys returned by the provider's prefix listing are excluded. The interface reports the 10,000-entry limit and directs older-history inspection to provider tools. **Refresh** reloads the history.
5. Select an older data version, then check the explicit confirmation that a new current version will be created and existing versions and delete markers will remain. Current versions and delete markers cannot be selected for restore. Changing the key, loading or changing pages, or selecting another version resets confirmation.
6. Choose **Restore selected version**. Restore is available only while bucket versioning is **Enabled**. Disabled or suspended buckets remain read-only. A current delete marker allows recovery from an older readable data version without removing that marker.
7. After successful preparation, the dialog closes and a toast directs you to **Uploads**. The **Version restore** transfer group shows progress and supports the queue's cancellation and retry controls. Queueing is not completion; inspect the transfer result.

A failed preparation clears the selection and history so that the next attempt requires loading and confirming again. A stale current version requires a fresh history lookup and confirmation. Retries retain the originally approved source version and destination guard, so they do not silently approve a newer destination. After an app restart or profile settings change, create a fresh restore from history.

## UI conventions

This is a narrow extension of the existing MUI interface. It uses `BaseDialog`, `StyledCheckbox`, small fully rounded buttons, and the existing theme. Secondary actions use the primary text color; the contained footer action is the restore action.

The medium-width dialog presents the key input and lookup action first, then the `s3://` object context, status and history table, selected-version confirmation, and footer actions. The fixed-layout table wraps long keys and version IDs. Selected rows and **Selected** labels identify the choice; selection buttons also expose `aria-pressed` and a version-specific accessible name. Progress has a status role, errors and warnings use alerts, and the confirmation is explicitly labelled. Closing is disabled while restore preparation is queueing the job.

## Contents and attributes

The selected historical version supplies bytes and these portable content attributes: content type, cache control, content disposition, content encoding, content language, and custom metadata.

For an existing object, the workflow reads the current destination and carries forward its ACL grants, tags, storage class, server-side encryption settings, KMS key and bucket-key setting, object-lock retention and legal-hold fields, website redirect, and expiry. Historical security settings are not copied over current settings. These are the readable, supported fields exposed by the provider; the operation does not change bucket policies.

For a currently deleted object, only the historical bytes and portable content attributes are supplied. Ownership, security, storage and retention use the destination bucket's defaults, and historical ACLs and tags are not resurrected.

Restoration downloads the selected object to a private temporary file on this computer and uploads it back to the same key. It requires temporary disk space for the object and uses this computer's network connection. Progress accounts for both download and upload, so the transfer total is twice the object size. Request, download, upload and storage charges may apply. The temporary file is released when the attempt ends; failed or cancelled multipart uploads attempt an abort. Cleanup depends on endpoint availability and permissions.

## Safety checks and limits

- History validates pagination markers, rejects missing version IDs and repeated cursors, and filters results to the exact key. History loading and restore preparation have bounded timeouts.
- Preparation requires explicit confirmation, an older version ID, a known current version, and enabled versioning. It checks the selected version with a version-specific `HeadObject`.
- Download uses both the selected `versionId` and `If-Match` with its ETag. Returned version ID, ETag and content length must match, and incomplete downloads are rejected before upload.
- The current version ID, deletion state, ETag and bucket versioning are checked before staging and again before the final write. Reading the current object's attributes also checks its version ID.
- Single-part `PutObject` and multipart completion use `If-Match` for an existing destination or `If-None-Match: *` for deleted-object recovery. No unconditional write fallback is used.
- S3 conditional writes compare ETags, not version IDs. A concurrent identical-content or metadata-only write in the gap after the final check can retain the same ETag and cannot be atomically guarded by this workflow. Attribute-only updates can also occur without creating a new version. Avoid concurrent edits while restoring.
- A change to bucket versioning after the final check cannot be atomically prevented. Do not suspend or otherwise change bucket versioning during a restore.
- A cancellation or lost response can race with a server committing the write. Inspect current history before deciding whether another restore is needed.

These checks rely on the provider correctly implementing version listing, version-specific reads and conditional writes. They are not universal guarantees for every S3-compatible endpoint. Unsupported APIs, unreadable archived versions, access denials, missing safety information and SSE-C objects fail the operation. This workflow does not initiate archive retrieval or accept customer-provided encryption keys.

## Permissions and provider compatibility

History calls `GetBucketVersioning` and `ListObjectVersions`, corresponding to AWS-style `s3:GetBucketVersioning` and `s3:ListBucketVersions` access. Restore also needs version-specific `HeadObject` and `GetObject` access, normally `s3:GetObjectVersion`, and destination write access through `PutObject` or multipart upload operations.

For an existing destination, preservation additionally reads its current `HeadObject` and version-specific `GetObjectAcl` and `GetObjectTagging`. AWS-style policies may require `s3:GetObject`, `s3:GetObjectVersionAcl` and `s3:GetObjectVersionTagging`, plus `s3:PutObjectAcl` and `s3:PutObjectTagging` to carry those values into the new object. Object-lock and encryption settings may require their corresponding read/write permissions and KMS decrypt or data-key permissions. Multipart failure cleanup needs `s3:AbortMultipartUpload`. Exact policy requirements depend on the endpoint and its bucket configuration.

Permission errors fail closed rather than discarding current permissions or tags. Only explicitly classified unsupported ACL/tag APIs are omitted. The exact documented empty MinIO placeholder ACL is accepted as carrying no object grants. An explicit `AccessControlListNotSupported` write response can retry without ACL grants for bucket-owner-enforced behavior, retaining conditional-write protection and the other attributes. Other ACL failures are not treated as permission to weaken access.

The production restore path does not require historical-delete permission, call `DeleteObject`, remove delete markers, or call `PutBucketVersioning`.

## Validation and development

The implementation passed the Rust, frontend, browser and release checks, plus lint, Clippy and build validation during this change. A disposable MinIO integration run passed restore of existing and deleted keys with payloads of 0 bytes, 5 bytes and 129 MiB. It checked restored content metadata, preservation of current tags and historical entries, rejection of stale guards, and absence of unfinished multipart uploads. This does not establish live AWS S3 or Cloudflare R2 compatibility; neither was tested live for this change.

The Rust integration test `version_restore_real_endpoint_preserves_history_and_rejects_stale_guards` is ignored by default and explicitly opt-in through `BROWS3_VERSION_TEST_ENDPOINT`. Run it only against a dedicated temporary MinIO instance configured with the test credentials `versiontest` / `version-test-only`. It creates a unique `brows3-version-test-` bucket, enables versioning, and deletes its own test versions and bucket on successful cleanup. Never point it at user data or a production endpoint.

Implementation sources:

- `src/components/dialogs/VersionHistoryDialog.tsx`: interaction, confirmation and history pagination.
- `src/app/bucket/page.tsx`: toolbar and file context-menu entry points.
- `src-tauri/src/commands/versions.rs`: profile checks, preflight and queue creation.
- `src-tauri/src/s3/versions.rs`: exact-key history and restore guards.
- `src-tauri/src/transfer/remote.rs`: version-pinned reads and temporary staging.
- `src-tauri/src/transfer/manager.rs`: guarded uploads, queue integration and integration tests.
- `src-tauri/src/transfer/sync.rs`: destination attribute preservation.
