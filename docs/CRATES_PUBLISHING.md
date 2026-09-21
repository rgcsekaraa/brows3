# crates.io publishing

Issue #37 is being delivered in two parts: a self-contained source crate, then
validated prebuilt installation with cargo-binstall. Do not close the issue until
both installation paths have been tested against a public release.

## Source package

The development Cargo manifest is deliberately not publishable. Its frontend is
outside the crate and excluded by Git. `scripts/prepare-crate.js` stages an
allowlisted package in a fresh temporary directory, includes the static frontend,
and enables Tauri's production custom protocol by default. The checkout and normal
Tauri development builds are unchanged.

The `crate-distribution` feature runs Tauri's build helper using inputs copied
into `OUT_DIR`, keeping its generated editor schemas out of the immutable crate
source. The packaged updater endpoints are disabled; native installers must not
overwrite a Cargo-managed installation.

```sh
pnpm install --frozen-lockfile
pnpm build
CRATE_DIR=$(node scripts/prepare-crate.js)
cargo package --manifest-path "$CRATE_DIR/Cargo.toml" --locked
```

Review the archive under the staged `target/package` directory. `cargo package`
extracts and compiles it without publishing. Keep the compressed archive below
10 MB. The included Monaco assets account for much of its size.

Initial local verification: macOS ARM64, Rust 1.97.1, full `cargo package --locked`
passed, archive approximately 9 MiB. Windows and Linux source installation still
need CI verification before advertising support there. Cargo reports an existing
yanked `spin 0.10.0` entry in the lockfile; review that dependency before the first
publication rather than silently updating the application's dependency graph.

## Account setup and publication

1. Verify the email address on your existing crates.io account.
2. Create a short-lived publishing token with the minimum required permissions
   for `brows3`. The first publication must be allowed to create the crate.
3. Store it directly in the repository's Actions secret `CARGO_REGISTRY_TOKEN`.
   Never paste the token into an issue, source file, or chat.
4. Run the `crates.io package` workflow without Publish enabled to validate it.
5. After publishing the matching desktop release, run this workflow on its
   `app-v<VERSION>` tag with Publish enabled.

The workflow refuses publication from a branch, mismatched tag, draft release,
or prerelease. It checks the extracted crate and archive size before uploading.
The first successful publish assigns crate ownership to the token's account.
Crates.io versions cannot be overwritten, so use the next release version for
new code rather than reusing a previously published desktop version.

Local publication is also possible after authenticating privately with
`cargo login`, then running `cargo publish --manifest-path "$CRATE_DIR/Cargo.toml"
--locked`. Only do so after checking the same release and version requirements.

## Prebuilt installation and verification

The manifest maps binstall to dedicated `brows3-v<VERSION>-<TARGET>.tar.gz`
release assets, each containing exactly `brows3` or `brows3.exe` at the archive
root. They are built from the same self-contained source crate, not extracted
from native installers. The embedded UI and disabled native updater are therefore
identical for both Cargo installation paths. Third-party quick-install fallback
is disabled; source compilation remains available.

The manual workflow first verifies the source package, then installs that exact
archive on native macOS ARM64/Intel, Linux ARM64/x86-64, and Windows x86-64 runners.
Each runner builds a release executable, archives it, and uses pinned binstall
1.23.0 to install it from a loopback-only HTTP server. Only the URL origin is
overridden: release path, filename, format, and binary layout use the real
manifest metadata. The installed executable then gets a ten-second startup
smoke test with an isolated portable profile. HTTP is allowed only for this
local test, not for actual release downloads.

Publication waits for every target to pass, uploads all five binary archives to
the matching public desktop release, then publishes the crate. A default run
only creates CI artifacts and never uploads release assets or publishes a crate.
Existing release assets are not overwritten. If a publish run fails after asset
upload, inspect those assets before retrying; do not bypass the overwrite guard.

The local macOS check uses a debug build to reuse existing build artifacts.
The release-build matrix must still pass in GitHub Actions before claiming
cross-platform support. A startup smoke test is not a full interactive UI test.

References: [Cargo publishing](https://doc.rust-lang.org/cargo/reference/publishing.html)
and [cargo-binstall metadata](https://github.com/cargo-bins/cargo-binstall/blob/main/SUPPORT.md).
