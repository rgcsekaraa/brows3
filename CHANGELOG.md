# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-01-08

### Fixed
- **Auto-Update**: Fixed missing release signatures in v0.2.0 which prevented auto-updates.
- **Build**: Resolved typescript build errors in recent/page.tsx.

## [0.2.0] - 2026-01-08

### Added
- **Deep Recursive Search**: New search capabilities in the bucket view. Toggle between instant local filtering and a deep, server-side recursive search of the entire bucket.
- **System Monitor**: Added a dedicated monitoring section in Settings to track API request rates, failures, and view live logs.
- **In-App PDF Preview**: Native PDF viewing support using the `<embed>` tag with toolbar controls hidden for a cleaner reading experience.
- **Profile Management**: Complete support for AWS Profiles. Switch between accounts/profiles instantly via the top bar.
- **Copy Filename**: Added context menu action to copy just the filename of an object.
- **Paste Logic**: Improved paste functionality. Pasting a file into the same folder now auto-renames it with a timestamp to prevent accidental overwrites.

### Changed
- **UI Polish**:
  - Compacted the "Deep Search" toggle to a clean checkbox.
  - Fixed "Size" column in file tables to prevent text wrapping (e.g., "53.6 KB" stays on one line).
  - Updated "About" modal styles and fixed links.
- **PDF Rendering**: Switched from `iframe` to `<embed>` for better cross-platform compatibility and stricter `Content-Type` enforcement in the backend.
- **Performance**: Optimized S3 listing with smart caching and background indexing.

### Fixed
- **App Persistence**: Fixed a critical issue where the application would reset to the "Setup" screen on every restart. Local state is now correctly rehydrated on launch.
- **Floating UI Elements**: Corrected layout issues in the Settings page where icons appeared misaligned.
- **Build System**: Improved Windows MSI build reliability and cross-platform compilation scripts.

## [0.1.0] - Initial Release

- Initial public release of Brows3.
- Core S3 file browsing features.
- High-performance virtualized table.
- Monocle editor integration.
