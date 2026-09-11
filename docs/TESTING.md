# Testing

Use Node.js 22, pnpm 11.2.2 and the Rust toolchain used by CI. Install dependencies with `pnpm install --frozen-lockfile`.

## Quick checks

```sh
pnpm test
pnpm typecheck
pnpm lint --max-warnings 0
pnpm test:rust
```

`pnpm test` runs the frontend unit and component tests, followed by the release-script tests. `pnpm test:rust` runs the native tests with all features. Build the frontend with `pnpm build` first when running native tests with all features from a fresh checkout.

| Location | Coverage |
| --- | --- |
| `tests/unit` | Preview classification, bucket caching, object pagination, profile-bound clipboard operations and transfer state |
| `tests/components` | Navigation, bucket management, favorites, keyboard controls, search scope, text-save conflicts, permissions and transfer listeners |
| `tests/smoke` | Production frontend workflows in Chromium and WebKit under the desktop CSP |
| `src-tauri/src` | Credential migration and persistence, safe downloads, transfer lifecycle, pagination, multipart operations and S3 request handling |
| `.github/scripts` | Release metadata, signatures and installer manifests |

Run a focused check while working:

```sh
pnpm exec vitest run tests/unit/objects.test.ts
cargo test --manifest-path src-tauri/Cargo.toml retried_download_retains
```

## Browser smoke tests

```sh
pnpm exec playwright install chromium webkit
pnpm test:smoke
```

The smoke command builds the production frontend, starts a server bound to `127.0.0.1`, and runs both browser projects. The server applies the CSP from `src-tauri/tauri.conf.json`. Set `SMOKE_PORT` to use a port other than 4173. An existing server is never reused.

The tests exercise direct S3 navigation, narrow-window navigation, profile switching, bucket favorites, empty listing pages, deep search, copy and paste, Monaco saves and conflicts, transfer queues and failure messages, cancellation, retry, delete confirmation and audio preview loading. Bucket management coverage includes creation, failed and successful deletion, policy conflicts and dismissal on profile changes. They fail on uncaught browser errors, unexpected native commands and CSP violations.

The desktop IPC boundary uses an in-memory fixture with fake profiles, objects and transfers. File-picker paths are fixture values. These tests do not read real credentials, write downloads or contact S3. Monaco is loaded from the production bundle. Editor changes use Monaco's model API because its input implementation differs between browser engines. Keyboard selection and clipboard shortcuts have separate coverage.

For a test-only change after a successful build:

```sh
pnpm exec playwright test
pnpm exec playwright test --project=webkit --grep 'real editor'
```

Playwright saves screenshots and traces for failures in `test-results/` and a report in `playwright-report/`. Both directories are ignored by Git.

```sh
pnpm exec playwright show-report
```

These browser tests complement native testing. They do not launch the packaged Tauri application or verify OS dialogs, keychains, PDF viewers or real provider behavior.

## Native tests

The default native suite uses temporary directories, fake credentials and local scripted HTTP responses. It covers successful and failed S3 requests without cloud access.

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
pnpm test:rust
```

Three provider integration tests are ignored by default. Two multipart tests create and delete test buckets and objects, and can create a large sparse local file. The folder test creates and removes an empty object in an existing bucket. Use credentials restricted to a disposable S3-compatible test service.

```sh
export BROWS3_S3_TEST_ENDPOINT=http://127.0.0.1:9000
export BROWS3_S3_TEST_ACCESS_KEY=minioadmin
export BROWS3_S3_TEST_SECRET_KEY=minioadmin
export BROWS3_S3_TEST_BUCKET=brows3-test
export BROWS3_S3_TEST_REGION=us-east-1
cargo test --manifest-path src-tauri/Cargo.toml --all-features --locked -- --ignored
```

## CI

Pull requests and manual runs use `.github/workflows/test.yml`. Frontend checks and both browser projects run on Linux. Native tests run on Linux, macOS and Windows. Native jobs use the default feature set so they do not require a frontend export. The Linux job also runs the folder integration test against Garage v1.0.1 in a temporary Docker container.

Release validation also runs the frontend unit and component suite, type checking, lint, the production build and native checks. Browser smoke tests run in the separate test workflow and do not publish releases.

Before uploading release assets, package checks verify macOS app signatures and disk images, Linux Debian metadata and AppImage startup, and Windows MSI metadata, NSIS installation and portable startup. These checks use temporary runner directories. They do not replace testing provider accounts or native dialogs on a desktop.
