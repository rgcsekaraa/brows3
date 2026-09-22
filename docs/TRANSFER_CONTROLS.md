# Transfer controls

Transfer controls add a bandwidth allowance to queued transfers and selection rules to local folder sync. The implementation extends the existing Settings rows and folder-sync dialog. The finish review disposition is ship, with no findings.

## Bandwidth per transfer

In Settings, enter a whole number in **Limit (KiB/s)** and select **Apply**. One KiB is 1,024 bytes. The default, `0`, means unlimited; a nonzero value must be between `64` and `1,048,576` KiB/s, inclusive. Invalid values are rejected by the UI and backend.

The setting is captured when a job is queued. Changing it affects newly queued jobs; pending and active jobs keep their captured allowance. Retrying a job retains that allowance.

The cap applies to uploads and downloads, including folder-sync uploads and both network phases of staged cross-profile copies and version restores. Ordinary server-side copies, editor operations, and preview reads are outside its scope. Each concurrent job receives its own allowance. For example, four jobs capped at 1,024 KiB/s can together approach 4,096 KiB/s of payload throughput.

This is application payload pacing, not a strict wire-rate limit. Upload bodies and downloaded payload chunks are paced. Protocol and network buffers can still produce bursts, and protocol overhead, latency, retries, disk work, and server performance can reduce achieved throughput. The displayed transfer speed need not equal the configured allowance.

Cancellation sets a shared flag checked while polling upload bodies and checks job state during download pacing. Multipart cancellation attempts cleanup. Cleanup is best effort and depends on the network and endpoint; there is no absolute cancellation or cleanup deadline promised to users.

## Folder-sync filters

Include and exclude patterns currently apply only to the folder-sync preview. They do not change ordinary uploads, downloads, copies, restores, editor operations, or previews elsewhere in the app.

Enter one pattern per line. Matching uses Rust `glob` 0.3.3 against case-sensitive paths relative to the selected local folder, using forward slashes. An empty include list accepts every file; otherwise at least one include must match. Any matching exclusion wins.

| Pattern | Meaning |
| --- | --- |
| `*.txt` | Text files directly in the selected folder |
| `**/*.txt` | Text files at the root and at any nested level |
| `cache/**` | Files under the relative `cache` folder |

Blank lines are ignored by the dialog. Spaces are literal and are not trimmed. Hidden filenames can match wildcards. There may be at most 100 patterns across both lists, with 1 to 1,024 UTF-8 bytes per pattern. Absolute paths, backslashes, control characters, and invalid glob syntax fail validation rather than silently falling back to an unfiltered sync.

Filtering happens after the local scan. The scan still reads and checks files throughout the selected folder, applies its 10,000-file limit, and rejects symlinks and unsupported entries before filters are applied. Excluding a path does not bypass scan validation or make the initial scan cheaper. Filtered files appear as **Filtered** in the preview and are never queued.

## Existing objects and approval

**Skip all existing objects** skips every matching key found in the destination listing, including objects whose content differs from the local file. These entries appear as **Skipped**, are not compared with HEAD requests, and are never queued. A missing destination is created conditionally with `If-None-Match: *`; an object appearing after the preview causes a conflict instead of an overwrite.

The default, **Replace changed files after confirmation**, keeps the existing guarded replacement workflow. **Changed** and **Unverified** entries require the explicit replacement checkbox before sync can start. Unverified means the content cannot be compared reliably and may be uploaded again even when it matches. Unchanged entries are not queued.

Replacement retains the previewed destination ETag guard and the existing workflow for preserving current object attributes. Single-part writes and multipart completion remain conditional; conflicts do not fall back to an unconditional overwrite. Local content is checked against the previewed snapshot before upload.

Changing include patterns, exclude patterns, or the existing-object choice clears the displayed preview and replacement approval. A fresh preview is required. Plans expire after 15 minutes and can be consumed only once. Previewing makes no remote changes. Sync never deletes local files or remote-only objects.

## Interface contract

The controls preserve the incumbent MUI presentation: compact labelled text inputs, existing Settings rows, `BaseDialog`, small rounded buttons, and the existing preview table and confirmation checkbox. The bandwidth field names its unit and explains per-job scope. Sync options sit above the preview, which reports filtered and skipped counts alongside the established actions. Busy controls are disabled and validation failures appear inline. This feature introduces no new global visual identity or raster assets.

## Verification and limits

The implementation was exercised against a real disposable MinIO endpoint with zero-byte, 256 KiB, and 129 MiB uploads and downloads. Checks covered minimum elapsed pacing time and downloaded content. A throttled multipart cancellation completed within the test's 15-second bound, with no remaining multipart upload or object. This bound is an integration assertion, not a production guarantee. No live AWS S3 or Cloudflare R2 validation was performed for this change.

The opt-in Rust integration test is `bandwidth_real_endpoint_upload_download_and_multipart_cancellation`. It is ignored by default and reads `BROWS3_CONTROLS_TEST_ENDPOINT`. Run it only against a dedicated temporary MinIO instance configured with access key `versiontest` and secret key `version-test-only`. It creates a unique `brows3-controls-test-<uuid>` bucket, writes test objects, and removes them and the bucket on success. A failed assertion may leave that unique test bucket for inspection and cleanup.

From `src-tauri`, with that disposable endpoint configured:

```sh
BROWS3_CONTROLS_TEST_ENDPOINT=http://127.0.0.1:19004 cargo test bandwidth_real_endpoint_upload_download_and_multipart_cancellation -- --ignored --nocapture
```

The completed verification also covered frontend tests, browser smoke tests, release checks, and Rust tests. The first full browser run encountered an existing cross-profile-copy WebKit chunk-load failure; the unchanged rerun passed all 72 browser tests.

## Implementation references

- [Validation and filter matching](../src-tauri/src/transfer/controls.rs)
- [Upload payload pacing](../src-tauri/src/transfer/speed.rs)
- [Queue snapshots, retries, download pacing, and integration test](../src-tauri/src/transfer/manager.rs)
- [Staged remote transfer download phase](../src-tauri/src/transfer/remote.rs)
- [Sync preview selection and approval](../src-tauri/src/commands/sync.rs)
- [Settings controls](../src/app/settings/page.tsx)
- [Folder-sync dialog](../src/components/dialogs/FolderSyncDialog.tsx)
