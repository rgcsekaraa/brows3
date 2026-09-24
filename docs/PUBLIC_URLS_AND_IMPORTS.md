# Public URLs and URL imports

## Copy public URLs

Select files and choose **Copy public URLs**, or use **Copy public URL** from a file's context menu. Connection settings provide optional public/CDN defaults and bucket-specific public roots. With no custom setting, Brows3 builds a path-style S3 endpoint URL. Keys are encoded segment by segment.

Each full URL can be edited for this copy only, including its host and path. This does not change saved connection settings. Multiple links are copied one per line. Folders are excluded. Links do not grant access or change bucket/object permissions.

**Check access** makes an anonymous HEAD request only when clicked. A successful check is not a guarantee of future access; some servers do not support HEAD. Signed URLs remain a separate operation, with requested expiry shown. Public URL settings and overrides reject query strings, fragments and embedded credentials.

## Import URLs into the current S3 folder

Create or open a folder using the existing explorer, then choose **Upload > Import from URLs**. Paste one source URL per line or select a CSV/JSON file. Review the rows before choosing **Import files**.

Each file supports a destination path, optional source headers, replacement approval, maximum download size, optional SHA-256 and 1 to 5 download attempts. Defaults are no replacement, 50 GiB maximum and 3 attempts. A batch allows 500 files and 2 MiB of configuration. Duplicate destinations and invalid settings prevent submission.

CSV requires a `url` column. JSON accepts an array of URLs or objects. Optional fields are `path`, `replace`, `headers`, `max_bytes`, `sha256`, `max_attempts`. CSV headers contain a JSON object with normal CSV quoting.

```json
[
  {
    "url": "https://downloads.example.com/report.csv",
    "path": "reports/report.csv",
    "replace": false,
    "max_bytes": 104857600,
    "max_attempts": 3,
    "headers": {}
  }
]
```

Files download through this computer to temporary disk, then use the existing S3 upload pipeline. Uploads and the transfer floater show the source-fetch or S3-upload phase, progress and speed. Unknown lengths remain indeterminate until known. Keep Brows3 running and allow enough temporary disk space.

## Failure and safety behavior

- Transient source failures retry with bounded backoff. Permanent access failures require correction. Resume requires a matching strong ETag and valid range; a server returning a full response restarts the download safely.
- Known lengths, configured size limits and optional checksums are checked before uploading. Unknown-length responses cannot provide an independent completeness guarantee without a supplied checksum.
- Cancellation uses the existing confirmation. Source requests are cancellable while stalled; S3 multipart cancellation uses the existing bounded cleanup/abort flow.
- Retry retains the destination and approval guards. **Edit source** starts a fresh review for an expired URL. **Remove from list** removes history only, never an S3 object.
- Replacement is opt-in and conditional on the destination ETag captured before queueing. New files use create-only conditional writes. A changed destination fails instead of being silently overwritten.
- Source URLs and headers are session-only, omitted from transfer journals and debug output. After restart, re-enter the source with **Edit source**. This is not a persistent link-collection feature.
- Only public HTTP(S) source addresses are supported. Private/local networks and metadata addresses are blocked; DNS is validated and pinned for every redirect. HTTPS downgrade redirects are blocked, and custom headers are not forwarded to another origin. Prefer HTTPS, especially for authenticated sources.
- No ACLs, bucket policies, existing transfer features or scheduled jobs are changed by these workflows.

## Verification

`tests/smoke/url-workflows.spec.ts` exercises actual rendered production UI with a mocked Tauri boundary in Chromium and WebKit. It covers profile settings, independent copy overrides, explicit access checks, paste/CSV/JSON review, validation, new-folder destinations, cancellation, replacement sources and history removal. It does not claim real provider writes through the browser harness.

Rust tests exercise streaming HTTP failures, resumptions, changed ETags, size limits, checksums, cancellation, session-only persistence and retry guards. The ignored `url_import_real_http_to_s3_round_trip_and_conflict` test was also run against a disposable MinIO server with a real public HTTPS source. It exercises the queued-job dispatcher, verifies stored bytes and create-only conflicts, and checks temporary cleanup. It requires `BROWS3_URL_TEST_ENDPOINT` and public internet access.

These checks do not certify every S3-compatible provider, CDN, network failure or multi-terabyte transfer. Other endpoint-dependent integration tests remain separately opt-in.
