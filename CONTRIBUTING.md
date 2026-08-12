# Contributing to Brows3

Thank you for considering a contribution to Brows3. Community involvement is what makes this project a reliable tool for the S3 ecosystem, and we appreciate every issue, suggestion, and pull request.

## Our Philosophy

Brows3 is built for speed. Every contribution should preserve performance as a first-class concern. We value:

- **Fast Listings** — Minimize S3 API latency wherever possible.
- **Responsive UI** — Maintain a premium, lag-free user experience.
- **Security** — AWS credentials must never leave the user's local machine.

## Development Setup

Brows3 is a **Tauri v2** application with a **Next.js** frontend and a **Rust** backend.

### Prerequisites

- **Node.js** (v20 or later) and **pnpm**
- **Rust** (stable toolchain)
- **AWS CLI** (configured with local profiles)

### Getting Started

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/rgcsekaraa/brows3.git
   cd brows3
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Run the application in development mode:**
   ```bash
   pnpm tauri dev
   ```

## Project Structure

- `/src` — Next.js frontend (React with MUI).
- `/src-tauri` — Rust backend, including core logic, the S3 client, and IPC handlers.
- `/src-tauri/src/s3` — AWS S3 clients, region discovery, and sorted-folder caching.

## Contribution Workflow

1. **Identify an issue.** If one does not already exist, please open an issue to discuss your proposal before beginning work.
2. **Create a feature branch:** `git checkout -b feat/your-feature-name`.
3. **Commit your changes** using clear, descriptive commit messages.
4. **Lint and format your code:**
   - Run `pnpm lint` for the frontend.
   - Run `cargo fmt` inside `src-tauri` for the backend.
5. **Open a pull request** targeting the `main` branch, and include a summary of the changes along with any relevant context or screenshots.

## Technical Guidelines

- **Rust:** Use `async`/`await` for all S3 operations. Keep IPC payloads small by paginating results.
- **Frontend:** Avoid unnecessary re-renders. Use the `VirtualizedObjectTable` component for any list exceeding 100 items.
- **State Management:** Use `Zustand` for global UI state, and delegate data-heavy state to the Rust backend.

## Code of Conduct

We are committed to fostering a respectful, inclusive, and collaborative environment. All contributors are expected to engage professionally and constructively in discussions, reviews, and other project interactions.

---

Maintained by [rgcsekaraa](https://www.linkedin.com/in/rgcsekaraa/). We look forward to your contributions toward making S3 browsing faster and more accessible.
