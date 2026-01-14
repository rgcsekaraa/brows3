# Brows3 🚀

[![Release](https://img.shields.io/github/v/release/rgcsekaraa/brows3)](https://github.com/rgcsekaraa/brows3/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build](https://github.com/rgcsekaraa/brows3/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/rgcsekaraa/brows3/actions/workflows/release.yml)

**Brows3** is a high-performance, open-source Amazon S3 desktop client designed for developers who demand speed. Built with a **Rust** core and a **Tauri**-powered frontend, Brows3 solves the "slow listing" problem of traditional S3 browsers through its unique prefix-indexed caching architecture.

Navigating through buckets with millions of objects is now as fast as browsing your local file system.


## ✨ Why Brows3?

Traditional S3 tools often suffer from latency when navigating deep folder structures or listing large numbers of objects. Brows3 rethinks the browsing experience:

- **⚡ Instant Navigation**: After an initial index, folder traversal happens **instantly**. No more waiting for "Loading..." spinners when clicking through directories.
- **🔍 Deep Search**: Perform instant, localized searches across your entire bucket. Find any file in milliseconds, even in massive datasets.
- **📦 Intelligent Background Indexing**: Brows3 populates its local cache in the background while you work, ensuring your view is always synchronized without blocking your interaction.
- **♾️ Hyper-Virtuoso Table**: Our custom-tuned virtualization engine handles lists of 100,000+ items with silky-smooth scrolling at 60fps.

## 🛠️ Feature Deep Dive

### 📂 File Management
- **Breadcrumb Navigation**: Path-based navigation for rapid traversal of complex hierarchies.
- **Bulk Operations**: Upload, download, and delete multiple files or recursive folders at once.
- **Mixed Content Support**: Seamlessly handle folders and files in a single drag-and-drop operation.
- **Copy-to-Clipboard**: Quick copy of S3 Paths, Keys, and Object URLs.

### 📄 Rich Previews & Editing
- **Built-in Editor**: Powered by **Monaco (VS Code's Engine)**. Edit text, JSON, and code files directly in S3.
- **Direct Edit Action**: Quick "Edit" button in the file list and context menu for instant code/text modifications.
- **Media Previews**: Native support for **high-resolution images**, **videos**, and **PDFs**.
- **Rendering Indicators**: Clear visual feedback for large image rendering states.

### Feature Deep Dive

#### 🚀 **Speed & Performance**
- **Rust-Powered Backend**: Core logic is written in Rust for near-instant operations.
- **Smart In-Memory Caching**: 
  - Sub-millisecond navigation for recently visited folders.
  - **Auto-Invalidation**: Cache automatically refreshes after you upload, delete, or modify files.
  - **30-Minute TTL**: Stale data (from external sources) is automatically purged.
- **Lazy Loading**: Efficiently handles buckets with millions of objects.

#### �️ **Enterprise & Restricted Access**
- **Direct Bucket Access**: Instantly navigate to specific buckets (e.g., `s3://my-secure-bucket`) even if you don't have `s3:ListBuckets` permission.
- **Profile-Gated Access**: Create isolated profiles for different AWS accounts or environments.
- **Cost Awareness**: UI indicators for cached data help you manage S3 API costs.

- **📄 In-App PDF Preview**: View PDFs directly within the application with a high-performance native renderer. Features embedded search, standard PDF navigation, and focused reading mode.
- **🌐 Automatic Region Discovery**: Profiles now automatically detect the correct AWS region from system configurations, enabling zero-config setup.
- **📑 Smart Tab Management**: Intelligent tab deduplication ensures you never have multiple tabs open for the same S3 path—automatically switching to existing tabs when searching.
- **⚡ Deep Recursive Search**: Overhauled with 5x more depth and context-awareness. Search recursively within specific folders with auto-region retry support.
- **📊 System Monitor**: Real-time visibility into application performance. Track API request success/failure rates and view live logs for debugging.
- **🔐 Profile-Gated Access**: Create isolated profiles for different AWS accounts or environments. Switch contexts instantly with zero friction.
- **⚙️ Enhanced Settings**:
  - Manage application data, clear cache, and check for updates manually.
  - One-click theme switching (Dark/Light/System).
  - Configure default regions and concurrency limits.
- **Auto-Updates**: Seamless background updates ensure you're always on the latest secure version.

## 🏗️ Technical Architecture

Brows3 leverages a tiered data strategy to achieve its performance:

1. **Rust Core (The Muscle)**: Handles all heavy-lift S3 networking, credential management, and local indexing using high-speed concurrency.
2. **Prefix-Indexed Tree**: An in-memory data structure that organizes S3's flat object list into a hierarchical tree, enabling instant directory lookup.
3. **Paginated IPC Bridge**: Data is transferred between Rust and the React frontend over a high-speed, paginated IPC channel, preventing UI hangs during large data transfers.
4. **SSG React (The UI)**: A Next.js-based frontend exported as a static site, providing the smallest possible memory footprint.

## 🚀 Installation

Brows3 is available for all major desktop platforms. Download the latest version from the [Releases](https://github.com/rgcsekaraa/brows3/releases) page.

| Platform | Installer Type |
| :--- | :--- |
| **macOS** | `.dmg` (Silicon/Intel), `.app.tar.gz` |
| **Windows** | `.msi`, `.exe` |
| **Linux** | `.deb`, `.AppImage` |

### Manual Build

If you prefer building from source, follow the instructions for your platform:

#### Prerequisites (All Platforms)
- **Node.js** v20+ and **pnpm** (install via `npm install -g pnpm`)
- **Rust** (see platform-specific instructions below)

#### 🪟 Windows Setup

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

#### 🍎 macOS Setup

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

#### 🐧 Linux Setup

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

## ⚠️ Troubleshooting (macOS)

If you see the error **"Brows3.app is damaged and can't be opened"** after downloading:

Brows3 is a free, open-source project and is not yet signed with a paid Apple Developer certificate. You can easily fix this by running one command in your Terminal:

```bash
sudo xattr -rd com.apple.quarantine /Applications/Brows3.app
```

For more details, see our [macOS Troubleshooting Guide](docs/MACOS_TROUBLESHOOTING.md).

## 👥 Contributors

We welcome contributions from the community! Whether you are a Rustacean, a React developer, or as a technical writer, your help is appreciated.

- **Founder & Maintainer**: [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/)
- **Core Engineering**: Brows3 Open Source Team

Want to become a contributor? Check out our [Contributing Guide](https://github.com/rgcsekaraa/brows3/blob/main/CONTRIBUTING.md) and join us in building the world's fastest S3 browser!

## 🤝 How to Contribute

1. **Check the Issues**: Look for "good first issue" labels.
2. **Standard Workflow**: Fork -> Branch -> Commit -> Pull Request.
3. **Code Quality**: Ensure Rust code is formatted with `cargo fmt` and TS code with `pnpm lint`.

## 📈 Roadmap
- [x] Multi-Account Support (Profiles) ✅
- [ ] S3-Compatible Storage support (MinIO, R2, etc.)
- [ ] Sync Folders (Local <-> S3)
- [x] Dark Mode / Custom Themes ✅ (Defaults to system, toggle available)

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---
Created by [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/). Built for the community.
