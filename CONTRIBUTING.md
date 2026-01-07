# Contributing to Brows3 🚀

First off, thank you for considering contributing to Brows3! It's people like you who make Brows3 a great tool for the S3 community.

## 🌈 Our Philosophy
Brows3 is built for speed. Every contribution should keep performance at its core. We value:
- **Fast Listings**: Minimizing S3 API latency.
- **Sleek UI**: Maintaining a premium, lag-free experience.
- **Safety**: Ensuring AWS credentials never leave the local machine.

## 🛠️ Development Setup

Brows3 is a **Tauri v2** application with a **Next.js** frontend and a **Rust** backend.

### Prerequisites
- **Node.js** (v20+) & **pnpm**
- **Rust** (stable)
- **AWS CLI** (configured with local profiles)

### Getting Started
1. **Fork and Clone**:
   ```bash
   git clone https://github.com/rgcsekaraa/brows3.git
   cd brows3
   ```
2. **Install Dependencies**:
   ```bash
   pnpm install
   ```
3. **Run in Dev Mode**:
   ```bash
   pnpm tauri dev
   ```

## 📂 Project Structure
- `/src`: Next.js frontend (React + MUI).
- `/src-tauri`: Rust backend (Core logic, S3 client, IPC).
- `/src-tauri/src/s3`: Custom prefix-indexed caching engine.

## 🤝 Contribution Workflow
1. **Find an Issue**: Better yet, open one to discuss your idea!
2. **Create a Branch**: `git checkout -b feat/your-feature-name`.
3. **Commit Your Changes**: Use descriptive commit messages.
4. **Lint and Format**:
   - `pnpm lint` for Frontend.
   - `cargo fmt` inside `src-tauri` for Backend.
5. **Open a Pull Request**: Target the `main` branch.

## 🏗️ Technical Guidelines
- **Rust**: Use async/await for all S3 operations. Keep the IPC message size small by using pagination.
- **Frontend**: Avoid heavy re-renders. Use the `VirtualizedObjectTable` for any lists over 100 items.
- **State**: Use `Zustand` for global UI state and `Rust` for data-heavy state.

## 📜 Code of Conduct
Please be respectful and collaborative. We aim to build a welcoming community for everyone.

---
Created by [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/). Let's make S3 browsing ultra-fast together!
