# Brows3

[![Release](https://img.shields.io/github/v/release/rgcsekaraa/brows3)](https://github.com/rgcsekaraa/brows3/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build](https://github.com/rgcsekaraa/brows3/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/rgcsekaraa/brows3/actions/workflows/release.yml)
[![Website](https://img.shields.io/badge/Website-brows3.app-blue)](https://www.brows3.app/)

**Brows3** is a high-performance, open-source Amazon S3 browser, S3 explorer, and S3 desktop client designed for developers who demand speed. Built with a **Rust** core and a **Tauri**-powered frontend, Brows3 improves slow S3 navigation with prefix-aware folder views, local caching, and a virtualized object table.

Navigating recently loaded buckets and prefixes feels close to browsing a local file system, while direct S3 path access keeps restricted buckets usable even without broad list permissions.

**Website:** <a href="https://www.brows3.app/" target="_blank">brows3.app</a>

Brows3 is built for people searching for a fast **S3 browser**, **AWS S3 client**, **S3 bucket explorer**, **S3 file manager**, or **S3-compatible storage browser** for providers like **MinIO**, **Cloudflare R2**, **Wasabi**, **STACKIT Object Storage**, and **DigitalOcean Spaces**.

## Screenshots

<p align="center">
  <img src="public/screenshots/website/dark/07-browse-folder-actions.png" alt="Brows3 dark mode object browser with folder search, upload, new folder, preview, edit, and object action controls" width="900">
</p>

| Add S3-compatible storage | Settings and updates |
| :---: | :---: |
| <img src="public/screenshots/website/dark/03-add-custom-s3-profile.png" alt="Brows3 custom S3 profile setup form with endpoint URL, access key, secret key, and region fields" width="440"> | <img src="public/screenshots/website/dark/11-settings-and-updates.png" alt="Brows3 settings page with theme, transfer concurrency, cache controls, updates, and system monitor" width="440"> |

## Who It Is For

Brows3 is a strong fit if you need:

- a desktop S3 browser for large buckets
- a faster S3 explorer than generic cloud-storage tools
- an open-source S3 client for AWS S3 or S3-compatible storage
- a GUI for MinIO, Cloudflare R2, Wasabi, STACKIT Object Storage, or DigitalOcean Spaces
- a developer-focused S3 file manager with editing, search, and transfer visibility


## Why Brows3?

Traditional S3 tools often suffer from latency when navigating deep folder structures or listing large numbers of objects. If you are comparing tools like an S3 browser, S3 explorer, S3 GUI client, or desktop client for S3-compatible storage, Brows3 focuses the browsing experience around:

- **Cached Bucket Discovery**: Bucket lists are cached per profile for 30 minutes so returning to the explorer is quick.
- **Deep Search**: Search recursively within the selected bucket or prefix, with explicit scan, result, and request limits to bound cost and memory use.
- **Accurate Large-Bucket Sorting**: Sort prefixes by name, size, modified date, or storage class with the backend ordering the complete result before pagination, up to 100,000 items or 100 S3 LIST requests.
- **Sorted-View Cache**: Complete-result folder sorts are cached in memory for the session and invalidated after writes or manual refreshes.
- **Virtualized Object Table**: The object table is tuned for large listings without rendering every row at once.

## Feature Deep Dive

### File Management
- **Breadcrumb Navigation**: Path-based navigation for rapid traversal of complex hierarchies.
- **Bulk Operations**: Upload, download, and delete multiple files or recursive folders at once.
- **S3-Compatible Delete Fallback**: Folder deletion falls back to single-object deletes when a provider rejects multi-object delete requests.
- **S3-Compatible Upload Compatibility**: Custom S3 endpoints use conservative checksum behavior for better compatibility with providers such as Wasabi and STACKIT Object Storage.
- **Large Multipart Uploads**: Files at or above 100 MiB use retryable, bounded-memory multipart transfers with adaptive part sizing, progress updates, and clean cancellation, including files beyond S3's 5 GiB single-PUT limit.
- **Content-Type Control**: Uploads infer MIME types from object names, while an editable Content-Type field in Properties accepts common suggestions or a validated custom media type without discarding existing tags, metadata, encryption settings, or ACL grants.
- **Mixed Content Support**: Seamlessly handle folders and files in a single drag-and-drop operation.
- **Copy-to-Clipboard**: Quick copy of S3 Paths, Keys, and Object URLs.
- **Presigned URL Sharing**: Generate temporary object links with configurable expiry directly from the bucket view.
- **Object Permissions**: View and apply S3 object ACLs for files and recursively for folder prefixes, with clear messages when a bucket or provider has ACLs disabled or unsupported.

### Rich Previews & Editing
- **Built-in Editor**: Powered by **Monaco (VS Code's Engine)**. Edit text, JSON, and code files directly in S3.
- **Direct Edit Action**: Quick "Edit" button in the file list and context menu for instant code/text modifications.
- **Configurable Text Preview Limit**: Choose a persisted 1–100 MB limit for text, HTML, and code previews. The Rust backend streams and enforces the same bound before text reaches the WebView.
- **Media Previews**: Preview **images**, **audio**, **videos**, and **PDFs** through presigned object URLs without loading them into the text editor's memory allowance.
- **Rendering Indicators**: Clear visual feedback for large image rendering states.

### Performance

#### **Speed & Performance**
- **Rust-Powered Backend**: Core logic is written in Rust for near-instant operations.
- **Targeted In-Memory Caching**:
  - Per-profile bucket discovery uses a **30-minute TTL**.
  - Complete-result sorted folder views are reused during the current app session, with FIFO eviction capped at 32 views and 100,000 listed items across the cache.
  - **Auto-Invalidation**: Relevant cached views are refreshed after uploads, deletes, edits, copies, and moves.
- **Lazy Loading**: Paginates large object listings to keep browsing responsive while preserving complete-result sorting for non-default sort orders.

#### **Enterprise & Restricted Access**
- **Direct Bucket Access**: Instantly navigate to specific buckets (e.g., `s3://my-secure-bucket`) even if you don't have `s3:ListBuckets` permission.
- **Profile-Gated Access**: Create isolated profiles for different AWS accounts or environments.
- **AWS IAM Identity Center (SSO)**: Use configured AWS SSO profiles through the SDK credential chain, with profile discovery and an AWS CLI v2 browser sign-in action for refreshing cached sessions.
- **Persistent Secure Profiles**: Manual and S3-compatible profiles survive restarts. macOS uses Keychain, Windows uses Credential Manager, and Linux uses freedesktop Secret Service. Portable mode and native-keychain failures use a plaintext local `secrets.json` fallback (restricted to mode `0600` on Unix) so portable installs remain self-contained.
- **Cost Awareness**: UI indicators show when the bucket-discovery list came from the frontend cache.

- **Automatic Region Discovery**: Profiles now automatically detect the correct AWS region from system configurations, enabling zero-config setup.
- **Smart Tab Management**: Intelligent tab deduplication ensures you never have multiple tabs open for the same S3 path—automatically switching to existing tabs when searching.
- **Deep Recursive Search**: Search recursively within specific folders with auto-region retry support, scanning at most 100,000 objects, issuing at most 100 S3 LIST requests, and returning at most 10,000 matches per search.
- **System Monitor**: Real-time visibility into application performance. Track API request success/failure rates and view live logs for debugging.
- **Enhanced Settings**:
  - Manage application data, clear cache, and check for updates manually.
  - One-click theme switching (Dark/Light/System).
  - Configure default regions, transfer concurrency, and the text-preview memory limit.
- **Auto-Updates**: Brows3 checks for updates and surfaces available signed releases from Settings/startup.
- **Signed Release Pipeline**: Release automation validates updater signing and publishes updater metadata for desktop update flows.

## Technical Architecture

Brows3 leverages a tiered data strategy to achieve its performance:

1. **Rust Core (The Muscle)**: Handles S3 networking, credential management, bounded deep search and previews, sorted-view caching, and multipart transfers.
2. **Prefix-Aware S3 Pagination**: Folder views use S3 prefixes, delimiters, and continuation tokens instead of loading an entire bucket before browsing.
3. **Paginated IPC Bridge**: Data is transferred between Rust and the React frontend over a high-speed, paginated IPC channel, preventing UI hangs during large data transfers.
4. **SSG React (The UI)**: A Next.js-based frontend exported as a static site, providing the smallest possible memory footprint.

## Search Keywords

Brows3 is relevant if you are searching for:

- Amazon S3 browser
- S3 browser desktop app
- S3 client for macOS, Windows, and Linux
- S3 explorer
- S3 bucket browser
- AWS S3 desktop client
- S3-compatible storage browser
- MinIO browser
- Cloudflare R2 desktop client
- Wasabi browser
- STACKIT Object Storage browser
- DigitalOcean Spaces client
- object storage explorer

## Alternatives And Comparisons

People often discover Brows3 while searching for:

- Cyberduck alternative for S3
- S3 Browser alternative
- open source S3 client
- fast S3 desktop client
- GUI client for Amazon S3
- MinIO desktop client
- R2 browser

Brows3 is focused on fast bucket navigation, deep search, and large-list performance rather than generic cloud-storage support across many unrelated providers.

| If you are searching for... | Brows3 positioning |
| :--- | :--- |
| `Cyberduck alternative for S3` | More focused on S3/object-storage workflows and large bucket navigation |
| `S3 Browser alternative` | Cross-platform open-source desktop option with Rust/Tauri backend |
| `MinIO client` | Works for S3-compatible endpoints through Custom S3 mode |
| `Cloudflare R2 browser` | Relevant when using R2 through S3-compatible credentials |
| `STACKIT Object Storage browser` | Works through Custom S3 mode using STACKIT's S3-compatible endpoint |
| `fast S3 desktop client` | Core product focus is speed, caching, and deep recursive search |

## AWS IAM Identity Center (SSO)

Brows3 uses the AWS SDK credential chain for shared profiles, including IAM Identity Center profiles configured in `~/.aws/config`. Configure the profile with AWS CLI v2 (for example, `aws configure sso`), choose **AWS Profile / IAM Identity Center (SSO)** in Brows3, select the discovered profile, and use **Sign in with AWS SSO** when its cached session needs refreshing. Brows3 reads the resulting temporary credentials through the SDK and does not copy the SSO access token into its profile store. See the [AWS IAM Identity Center CLI guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) for profile setup.

## S3-Compatible Provider Setup

Brows3 keeps S3-compatible providers generic: use **Custom S3 / Compatibility Mode** and enter the provider endpoint, region, and access keys supplied by your object-storage account. Shared AWS profiles with `endpoint_url` are also supported and use path-style bucket addressing for MinIO-style endpoints.

### STACKIT Object Storage

Use these values when creating a custom S3-compatible profile for STACKIT Object Storage:

| Field | Value |
| :--- | :--- |
| Authentication Method | `Custom S3 / Compatibility Mode` |
| Endpoint URL | `https://object.storage.eu01.onstackit.cloud` |
| Default Region | `eu01` |
| Access Key ID / Secret Access Key | Your STACKIT object-storage credentials |

Brows3 uses path-style requests for custom endpoints, and the STACKIT EU01 endpoint supports path-style buckets. The region field is free-form, so type `eu01` directly even if it is not listed as an AWS region suggestion.

## GitHub Setup

To improve discoverability inside GitHub itself, set the repository description and topics in the repo settings.

Suggested repository description:

`Fast open-source S3 browser, S3 explorer, and desktop client for Amazon S3, MinIO, Cloudflare R2, Wasabi, STACKIT Object Storage, and other S3-compatible storage.`

Suggested topics:

`s3`, `amazon-s3`, `s3-browser`, `s3-client`, `s3-explorer`, `object-storage`, `minio`, `cloudflare-r2`, `wasabi`, `stackit`, `digitalocean-spaces`, `tauri`, `rust`

## Installation

Brows3 is available for all major desktop platforms. Download the latest version from the [Releases](https://github.com/rgcsekaraa/brows3/releases) page.

| Platform | Installer Type |
| :--- | :--- |
| **macOS** | `.dmg` (Apple Silicon/Intel), `.app.tar.gz` updater archives |
| **Windows** | `.msi`, `.exe`, portable `.zip` |
| **Linux** | `.deb`, `.AppImage` for x64 and ARM64 |

Windows releases are configured to bundle the WebView2 runtime with the installer so fresh machines do not depend on a separate runtime download during installation.

The published Winget package is `Brows3Team.Brows3`:

```powershell
winget install --exact --id Brows3Team.Brows3
```

Each release attaches Winget manifests generated from the published MSI and NSIS assets. The public Winget catalog is updated through a validated pull request to `microsoft/winget-pkgs`; catalog indexing can lag behind the GitHub release briefly.

### Manual Build

If you prefer building from source, follow the instructions for your platform:

#### Prerequisites (All Platforms)
- **Node.js** v22+ and **pnpm** (install via `npm install -g pnpm`)
- **Rust** (see platform-specific instructions below)

#### Windows Setup

1. **Install Rust**:
   - Download and run the installer from [rustup.rs](https://rustup.rs)
   - Or run in PowerShell: `winget install Rustlang.Rustup`
   
2. **Restart your terminal** to refresh the PATH

3. **Verify installation**:
   ```powershell
   cargo --version
   rustc --version
   ```

4. **Clone and run**:
   ```powershell
   git clone https://github.com/rgcsekaraa/brows3.git
   cd brows3
   pnpm install
   pnpm tauri dev
   ```

#### macOS Setup

1. **Install Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

2. **Install Xcode Command Line Tools** (if not already installed):
   ```bash
   xcode-select --install
   ```

3. **Clone and run**:
   ```bash
   git clone https://github.com/rgcsekaraa/brows3.git
   cd brows3
   pnpm install
   pnpm tauri dev
   ```

#### Linux Setup

1. **Install Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```

2. **Install system dependencies** (Debian/Ubuntu):
   ```bash
   sudo apt update
   sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
   ```

3. **Clone and run**:
   ```bash
   git clone https://github.com/rgcsekaraa/brows3.git
   cd brows3
   pnpm install
   pnpm tauri dev
   ```

#### Release Build (All Platforms)

```bash
pnpm tauri build
```

## Troubleshooting (macOS)

If you see the error **"Brows3.app is damaged and can't be opened"** after downloading:

This usually means the build was downloaded through a browser and Gatekeeper has quarantined it. First, drag `Brows3.app` into `/Applications`, launch it from `/Applications`, and eject the mounted DMG before deleting the installer. If Gatekeeper still blocks the app, run:

```bash
sudo xattr -rd com.apple.quarantine /Applications/Brows3.app
```

Current community builds may still need the quarantine-removal step above. For more details, see our [macOS Troubleshooting Guide](docs/MACOS_TROUBLESHOOTING.md) and [release signing setup guide](docs/RELEASE_SIGNING.md).

## Release Keys

For auto-updates to install correctly, the GitHub Actions secrets must include `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the matching public key must be present in `src-tauri/tauri.conf.json`. The exact GitHub path is:

`Repository Settings -> Secrets and variables -> Actions`

If you already added the secrets for Tauri, double-check that the secret names are exact and that the committed updater `pubkey` still matches the private key currently stored in GitHub.

## Contributors

We welcome contributions from the community! Whether you are a Rustacean, a React developer, or as a technical writer, your help is appreciated.

- **Founder & Maintainer**: [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/)
- **Core Engineering**: Brows3 Open Source Team

Want to become a contributor? Check out our [Contributing Guide](https://github.com/rgcsekaraa/brows3/blob/main/CONTRIBUTING.md) and join us in building the world's fastest S3 browser!

## How to Contribute

1. **Check the Issues**: Look for "good first issue" labels.
2. **Standard Workflow**: Fork -> Branch -> Commit -> Pull Request.
3. **Code Quality**: Ensure Rust code is formatted with `cargo fmt` and TS code with `pnpm lint`.

## License

Distributed under the MIT License. See `LICENSE` for more information.

---
Created by [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/). Built for the community.
