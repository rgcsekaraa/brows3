# Encrypted upload timing

## Encryption start to the wire

The [executed comparison notebook](benchmarks/encryption-before-wire.ipynb) contains the sampled CPU functions, their callers, and paired wall-clock timings for 4 KiB and 8 MiB files. Start Jupyter from the repository root on x86-64 Linux.

```bash
nix develop .#notebook -c jupyter lab docs/benchmarks/encryption-before-wire.ipynb
```

Set `run_raw_capture = True` in **Run raw capture** and run all cells to save and plot a fresh set. To collect the same files from the shell, supply a new directory.

```bash
nix develop .#notebook -c bash scripts/capture-encryption-profile.sh ./src-tauri/target/my-capture
```

Each capture produces four original gperftools `.prof` files, four symbolized pprof `.pb.gz` profiles and four compressed weighted stack listings used by the notebook. Inspect a symbolized profile with `pprof -top path/to/8mib-encrypted.pb.gz` in the notebook shell. The sample filter opens at the start of preparation and closes at the signed PUT pre-transmit hook across all process threads. Each case warms up once and accumulates three seconds inside the window. CPU samples attribute work while a thread executes. The separate latency benchmark also includes time spent waiting.

Run the release latency benchmark from the repository root. On x86-64 Linux the pinned toolchain is available through `nix develop`.

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --release --lib \
  profile_encryption_before_wire -- --ignored --nocapture --test-threads=1
```

The protected timer starts immediately before `encrypt_object` reads the source. It includes authenticated encryption into the production temporary file, rewind, request-body preparation and AWS SDK request signing. The stop timestamp is the first instruction of the SDK pre-transmit hook for a signed object PUT. The hook then terminates the request before HTTP transport. Both the already-unlocked key and the open source and temporary files are ready when the timer starts.

The same hook measures ordinary preparation starting at the production plain uploader's entry, after the transfer job has been created. It prepares a streaming request body. The protected uploader stages the entire ciphertext before it can send. Source creation and browser interaction take place outside both timers.

Each `BROWS3_ENCRYPTION_NS` JSON record contains the payload size, 21 protected samples in `samples_ns` and the paired ordinary samples in `plain_samples_ns`. Both arrays use nanoseconds and exclude one warm-up per mode. The two modes alternate order. The 4 KiB and 8 MiB workloads both use single PUT.

## End-to-end transfer profiles

**Measurement status:** No timings are available from the CSF worker for baseline `24b02bd0aea2bf2bbfb6ecb0b02cc35586700cd8`. Cargo and a disposable S3 service were unavailable; the worker could not execute the store's Cargo binary. The repository locks `aws-sdk-s3` to 1.121.0, not the available vendored 1.159.0. CSF's Go/flake preflight is not a Rust build. An unrun benchmark, sample data, crypto-only benchmark, or SDK-only benchmark is not a transfer profile.

### End-to-end timing boundary

Wall time starts immediately before the production Rust transfer executor and ends when it returns, separately for upload and download. Plain mode uses `TransferManager::execute_job`; protected mode uses `transfer_with_client`, the dispatch called by the UI's native upload/download commands. It includes the session check, per-operation descriptor GET, file I/O, object requests and body encryption/authentication, with identical ordinary object keys in both modes. Fixture setup generates production descriptors and publishes them to fresh physical buckets with the SDK. The production unlock (including passphrase derivation) is **outside** the per-file timer and reported separately as `BROWS3_UNLOCK`. `BROWS3_REFUSED` records separate locked, missing-descriptor and replaced-descriptor refusal probes. UI/IPC, queue wait, credential/client resolution, verification and cleanup are excluded. This benchmark does not establish that frontend routing selects the right command. Stored bytes are the **actual raw GET body length**, not protocol traffic, heap use, disk allocation, or the application's progress counter.

Every pass uses a fresh key and no-clobber destination, one transfer at a time, no throttling, a warmed client and identical deterministic non-secret content (successive SHA-256 digests of little-endian `u32` block numbers starting at zero). At both 4 KiB and 8 MiB, drop sample 0 and retain all five subsequent measurements. Both sizes are below the original multipart threshold. Raw GET verifies the entire original object for plain uploads; protected uploads must expand and must not disclose the first 32-byte source marker. Both downloads must match the source SHA-256. The marker check is a regression detector, not a proof of confidentiality. Wrong-passphrase checks are outside the timer. This workload does not measure queue throughput, multipart, WAN, TLS, cold storage, or large-file memory use.

## Reproduce on a local test host

Use the Rust toolchain and native dependencies in `.github/workflows/test.yml`, Bash, jq, sha256sum, Docker, and **one disposable** MinIO container. Make the server image an immutable digest available on that host. Keep host, CPU/load, temporary filesystem, target, compiler, release build flags and image fixed for the whole comparison. Record the CPU model, backing storage and any CPU limits alongside the results. Do not point this at production: it creates and deletes test buckets. The harness only accepts a numeric loopback port and uses fixed test credentials.

```bash
export PROFILE_FIXTURE='quay.io/minio/minio@sha256:<local-image-digest>'
export BROWS3_PROFILE_PORT=19000
docker run -d --rm --name brows3-transfer-profile \
  -p 127.0.0.1:$BROWS3_PROFILE_PORT:9000 \
  -e MINIO_ROOT_USER=profile-test -e MINIO_ROOT_PASSWORD=profile-test-only \
  "$PROFILE_FIXTURE" server /data
curl --fail --retry 15 --retry-connrefused "http://127.0.0.1:$BROWS3_PROFILE_PORT/minio/health/ready"
```

In the original source tree, overlay **only** the shared `src-tauri/src/transfer/manager/transfer_profile.rs`, the `#[cfg(test)] pub(crate) mod transfer_profile;` declaration in `src-tauri/src/transfer/manager.rs`, and the shell runner. Do not copy the integrated manager over the original. In the integrated tree, run both modes. Use fresh result directories outside either source tree:

```bash
# From the original tree with benchmark-only overlay:
PROFILE_REVISION=24b02bd0aea2bf2bbfb6ecb0b02cc35586700cd8 bash scripts/profile-transfer.sh plain /tmp/brows3-before
# From the integrated tree (set PROFILE_REVISION to its actual snapshot):
bash scripts/profile-transfer.sh plain /tmp/brows3-after-plain
bash scripts/profile-transfer.sh protected /tmp/brows3-after-protected
bash scripts/compare-transfer-profiles.sh /tmp/brows3-before /tmp/brows3-after-plain /tmp/brows3-after-protected
docker stop brows3-transfer-profile
```

Archive `environment.txt`, `test.log`, `raw.jsonl`, and `summary.json` for **each** run. Require equal workload hashes and payload sizes across runs. Compare integrated plain to original plain for unrelated drift, then protected to integrated plain for incremental cost; report each median duration and stored-byte difference per size. If timings drift materially between plain runs, repeat in reverse order before attributing the difference to encryption. Test failure, missing sample, or a Cargo filter matching no tests invalidates the run.

The existing `.github/scripts/start-garage-test.sh` fixture configures region `garage` and grants its key rights on a single pre-created `brows3-test` bucket. These profiles create fresh physical buckets with separate identities. A Garage run needs verified create/conditional-write support and its own complete before/after series; do not mix backends within a comparison.

## Source index (original revision)

| Operation | Entry point → byte path | Covered? |
|---|---|---|
| Single-file upload | `src/lib/tauri.ts` → `commands/transfer.rs::queue_upload` → `transfer/manager.rs::{process_queue,execute_queued_job,execute_job,upload_file,upload_prepared}` → `transfer/speed.rs::track_limited` → conditional SDK PUT | Executor through PUT |
| Single-file download | `queue_download` → `execute_job` → SDK GET → `pace_download` and `transfer/download.rs::PendingDownload` write, flush, sync, commit | Executor through publish |
| Multipart | `transfer/manager.rs::multipart_upload_file` and `s3/multipart.rs` plan/abort/complete | No |
| Folder operations | `commands/transfer.rs::{queue_folder_upload,queue_folder_download}` enumerate per-file jobs; folder downloads map relative paths | No |
| Cross-profile copy, restore, sync, scheduled sync, URL import | `commands/{cross_copy,versions,sync,jobs,urls}.rs`; `transfer/{remote,sync,url_import}.rs` stage/snapshot; manager dispatches guarded operations | No |
| Object editing, previews, direct operations and sharing | `commands/objects.rs::{get_object_content,put_object_content,get_presigned_url}`, `commands/operations.rs` GET/PUT/copy/move, `commands/urls.rs` public URLs | No |

Rust paths in the table are relative to `src-tauri/src`. No result for the ordinary file path implies that alternate operations encrypt, decrypt or preserve metadata.

## Bucket-policy acceptance matrix

These are independent checks to perform, **not** claims that the current build passed. Use direct Rust entry points as well as the UI. Inspect raw provider state after every attempt: body bytes, object versions, unfinished uploads and the destination filesystem. A disabled button, error message, filename suffix, metadata flag or failed final response alone is insufficient evidence.

| Case | Setup / operation | Required observation |
|---|---|---|
| Regular file | Create a new protected bucket; use ordinary upload/download with an ordinary key (no encryption suffix). Repeat with the session locked and with the wrong key. | Unlocked writes store only authenticated ciphertext and recover the exact local hash. Refusal creates no object, plaintext file or orphaned part; an existing destination is unchanged. |
| Batch and background | Folder uploads, sync create/replace, saved/scheduled sync, URL import, cross-profile staging, version restore, retry/recovery, queued job admitted immediately before a mode change | Each producer uses the authoritative mode when it actually writes, or refuses; no silent fallback. Include conditional/conflict/retry and cancellation branches. |
| Direct writes | Invoke raw local file PUT, empty folder-marker PUT (including region retry), text editor conditional PUT, content-type replacement via self-copy | Encrypt/retain a valid envelope, or refuse before any data mutation. Do not silently introduce plaintext even through an empty file or shortcut. |
| Copy/move | Same- and cross-profile; plain→protected, protected→plain and two protected buckets with different keys; single and multipart copy | No unverified server-side copy across protection contexts. On rejection, destination is unchanged and move does not delete source. No plaintext uploaded as an intermediate part. |
| Mode transition | Attempt adoption/downgrade on existing empty and nonempty buckets: current content, mixed bodies, only noncurrent versions, delete markers, folder placeholders, incomplete uploads. Include providers returning already-owned success for a repeated create. | No change-mode/adopt API; no body rewrite. A failed/ambiguous create must not initialize an existing bucket as if new. Do not infer mode from contents, object key suffixes, or an incomplete listing. |
| Uncertain provider state | Denied listing or header GET, timeout, ambiguous region, missing, malformed, unrecognized or replaced header; missing trusted key/identity after restart | An ordinary-name bucket keeps its legacy policy. A reserved-name bucket fails closed, never downgrades, and preserves prior objects. An externally inserted plaintext body must not be returned as decrypted data. |
| First-write race | Pause after reserved bucket creation but before header commit, submit first simple PUT and multipart start/complete; race two creators, interrupted initialization and alias profiles. | Before authenticated initialization every data write fails; the only permissible write is the winning conditional header create. No replace-header fallback or semantic mode change. |
| External writes | Create an object with a second raw SDK client using separate credentials, both before and after enabling; read/delete/replace any policy marker if authorized. | Record what the provider actually enforces. Local application guards do not control external principals, nor migrate existing objects. Scope any guarantee explicitly. |
| Alternate addresses | Address the same bucket via two profiles, an S3 access-point ARN/alias, multi-region access point, Object Lambda or opaque custom-endpoint alias. Test both source and destination of copies. | Resolve an authoritative physical identity or reject unsupported addressing before any payload operation. A syntactically ordinary alias can point at a protected physical bucket; bare suffix matching on the alias is not enough. Document denied legacy addressing forms and unobservable provider-side remapping. |
| Private bucket label | Pick a unique marker as the friendly label, create two protected buckets with that same label and two independent keys. Inspect raw bucket names and URLs, request keys/headers, stored descriptor, object bytes and metadata. Attempt unlock with wrong key, and with a descriptor from the other bucket. | Neither container includes a user slug. Same-label buckets have independent opaque physical identities and randomized descriptors; neither raw reads nor failed unlocks reveal the marker. Keep the marker out of fixture object keys to test label leakage separately: object names, sizes, timing and access patterns are not made private merely by sealing the body. |
| Other reads | Native preview/editor, direct file GET, public/presigned URLs, copy and restore from an existing file, locked/unlocked | No plaintext reaches an unauthorized reader and no ciphertext is silently presented as recovered plaintext. Object keys, sizes and other visible metadata are not protected merely by encrypting the body. |

### State model and counterexamples

Classify the **actual physical destination bucket name** on every Rust data route. Let `P(b)` mean the physical name is exactly `b3e1-` followed by 32 lowercase hex digits. Generate the randomized descriptor before creation; these digits commit to the first 128 bits of SHA-256 over the exact descriptor bytes. The friendly label never supplies a physical-name prefix. The descriptor key is `.brows3/key-v1`; do not infer protection from the presence of this key in an ordinary-name bucket or from an object key suffix. Let `A(b)` mean that the descriptor's bytes match the name commitment and an authorized session has authenticated the descriptor/key for the intended bucket identity. These are target properties, not a proof that every implementation entry point enforces them.

| Physical bucket / event | Permitted next state / behavior |
|---|---|
| Absent → create legacy | New ordinary name. Ordinary transfer behavior, regardless of magic-looking object names or contents. |
| Absent → create protected | New generated reserved name; only the initialization path may conditionally create its header. Before successful authentication, no data writes. |
| Reserved, locked or unknown → write | Refuse before PUT, multipart start/parts/complete, copy, or retry. No transition to ordinary. |
| Reserved, authenticated → write | Encrypt before sending any payload or refuse unsupported operation. Copy requires a validated compatible context, not just a destination suffix. |
| Reserved → lock, missing/replaced header, restart | Clear/invalidate authorization for that identity as appropriate. Do not interpret a missing header as permission to send or accept plaintext. |
| Existing → convert/adopt | No such transition. Ordinary name stays ordinary and reserved name stays protected, including when all objects are deleted. |

For a participating client, the intended invariant is: whenever a data operation can write into `P(b)`, it either refuses without mutating data or transmits an authenticated envelope for that context. The base case is a newly created, not-yet-initialized bucket that cannot accept application payloads. The inductive step only holds if *every* native write, including copy, retries, pending work and alternate clients selected after region discovery, reaches the guard. Verify each row above; do not infer completeness from the single-file benchmark.

Counterexamples: (1) If a client decides “plain” after a failed header GET, an upload racing header creation sends plaintext to a reserved bucket. (2) If only UI or queue admission checks mode, a direct edit, server-side copy or retried sync can still write plaintext. (3) An external SDK principal with write access can insert arbitrary bytes even when every Brows3 route is correct; a local client cannot establish a provider-wide no-plaintext invariant. Public metadata, denial of service and out-of-band object deletion are not addressed by body encryption.

`jq -n -f scripts/profile-bucket-model.jq` explores the symbolic legacy/reserved state machine for three events, deduplicates reachable states, then checks every possible fourth transition (including retry and a no-op conversion). It also runs a deliberately incorrect missing-header fallback and requires a plaintext-write counterexample. Hashes and session identities are abstracted to bound/foreign and authorized/unauthorized: the model is neither a cryptographic test nor evidence about actual Rust paths or race freedom. In particular, the absence of an unsafe model transition cannot show that a real command consults its guard.
