# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
 
## [0.2.17] - 2026-01-15
 
### Added
- **Actionable Toasts**: Transfer "Queued" notifications now include a "View" button to instantly navigate to the relevant Downloads or Uploads page.
- **Improved Linux Support**: Added high-resolution (512x512) app icon for pixel-perfect rendering on Ubuntu/Linux desktops.
- **Download Controls**: Added consistent "Retry" and "Cancel" actions for download jobs.

### Fixed
- **Large Download Freeze**: Resolved critical UI freeze when downloading large files (10GB+) by implementing smart progress event throttling.
- **Sidebar Loading Glitch**: Fixed a race condition where rapidly switching buckets could display incorrect data from stale network requests.
- **Table Stability**: Fixed layout shifts and indentation issues in transfer tables (Downloads/Uploads) for a rock-solid UI.

## [0.2.16] - 2026-01-14
 
### Added
- **Custom App Icon**: New premium goose mascot branding across app icon, header, and About dialog.
- **Instant Theme Switching**: Removed all transition delays for snappy dark/light mode toggling.

### Improved
- **Light Mode Contrast**: Darkened primary orange and increased sidebar selection/hover opacity for better visibility.
- **Tab Close Button**: Enlarged close button (16px) for easier clicking.
- **About Dialog**: Streamlined by removing developer/usage info sections.

### Fixed
- **Transfer Panel**: Added Started, Finished, and Elapsed time columns with correct timestamps.
- **Uploads Page**: Applied same time column improvements and verified grouping logic.

## [0.2.15] - 2026-01-13
 
### Added
- **macOS Troubleshooting Guide**: Added prominent documentation and in-app markers for bypassing Gatekeeper "Damaged App" errors on non-notarized builds.
- **Improved README**: Included immediate workaround commands for macOS users directly in the main repository page.

## [0.2.14] - 2026-01-13
 
### Added
- **Deep Search Overhaul**: Increased recursive search depth by 5x (scans up to 50,000 objects). Added context-aware prefix support and robust region auto-retry logic for exhaustive searching.
- **Tab Deduplication**: The search bar now intelligently switches to existing tabs if the target path is already open, preventing workspace clutter.

### Fixed
- **Application Stability**: Resolved critical `TypeError` crashes during navigation by implementing mandatory `Suspense` boundaries for Next.js layouts.
- **Enhanced Safety**: Added defensive null-checks for search parameters and default props for virtualization tables to eliminate "Load failed" errors.
- **State Cleanup**: Implemented global reset logic when deleting profiles, ensuring all tabs, history, and regions are cleared for a clean slate.

## [0.2.13] - 2026-01-13
 
### Added
- **Automatic Region Discovery**: Profiles imported from generic `~/.aws/config` files now automatically detect and select the correct region, eliminating manual configuration.
- **Direct Object Navigation**: Support for pasting direct S3 file URIs (e.g., `s3://bucket/file.json`). The app intelligently distinguishes between files and folders without forcing trailing slashes.
- **Extended File Support**: Massive expansion of supported editable file types. Now supports editing and previewing for YAML, TOML, INI, Shell Scripts, Rust, Go, Python, Terraform, Dockerfiles, and many more.

## [0.2.12] - 2026-01-12
 
### Added
- **Direct Edit Action**: Added "Edit" icon to the file list and dedicated "Edit" option in context menu for text-based files.
- **Developer Information**: Added developer details and quick-start instructions to the "About" dialog.
 
### Fixed
- **Window Management**: Application now launches in a maximized state by default for immediate full-screen productivity.
- **Connection Test Reliability**: Fixed a bug where connection tests would continue running even after changing form values. Tests now automatically reset on any input change.
- **Modal Scrollability**: Fixed layout issue where the "Create Profile" modal was not scrollable on smaller screens or minimized windows.
- **File Editing**: Resolved issues with the in-app editor not saving correctly and improved state management for file previews.
 
## [0.2.11] - 2026-01-12

### Fixed
- **Release Automation**: Updated workflow to automatically extract changelog notes for GitHub Releases.
- **Linux Window Controls**: Added native file/window menus for Linux to improve window manager integration and address potential close button responsiveness issues.

## [0.2.10] - 2026-01-12

### Fixed
- **Restricted Prefix Navigation**: Fixed manual path navigation (`Ctrl+Shift+P`) to correctly use the active profile's region. This enables users to jump directly to specific S3 folders (e.g., `s3://bucket/prefix/`) even if they don't have permission to list the bucket root.
- **S3 Error Logging**: (Included) The fix for opaque error logging (`[object Object]`) is now properly included in this release.

## [0.2.9] - 2026-01-12

### Fixed
- **S3 Error Logging**: Fixed opaque error messages (previously showing as `[object Object]`) when accessing restricted buckets. Now correctly displays "Access Denied" or other backend errors to help with debugging permissions.
## [0.2.7] - 2026-01-10

### Fixed
- **Connection Setup Error**: Fixed "Cannot read properties of undefined (reading 'invoke')" error on the new connection setup page when running in web context. The Tauri invoke function is now dynamically imported only when running inside the Tauri desktop application.

## [0.2.6] - 2026-01-10

### Fixed
- **Auto-Update Not Working**: Fixed the `update.json` manifest generation in GitHub Actions workflow. The previous version had a bash subshell bug that caused platform URLs and signatures to not be populated. Auto-update should now work correctly on all platforms (macOS, Windows, Linux).

## [0.2.5] - 2026-01-10

## [0.2.4] - 2026-01-10

### Fixed
- **All Buckets Page Refresh**: Fixed loading skeleton not showing during refresh - now properly displays loading state when clicking Refresh.
- **Bucket View Refresh**: Fixed skeleton overlay visibility issue in bucket content view.
- **Footer Version**: Updated footer to display correct version number.

### Performance
- **Transfer Store Optimization**: Skip state updates when transfer progress hasn't changed, reducing unnecessary re-renders during heavy file transfers.
- **Icon Caching**: Pre-populated icon map with 47 file type icons for O(1) lookup instead of creating JSX elements on every render.
- **useBuckets**: Removed unnecessary `useMemo` wrapper from trivial cache age calculation.

### Changed
- **MUI Stock Experience**: Reverted to stock Material UI styling for menus, buttons, and inputs instead of heavy customizations for a more consistent and familiar UI.

## [0.2.3] - 2026-01-09

### Fixed
- **Bucket Refresh**: Fixed refresh button not showing loading state. Now clears data immediately and properly refreshes from S3.
- **Backend Cache Invalidation**: Implemented `remove_bucket_cache` in Rust backend to properly clear stale data on refresh.

### Changed
- **UI Polish - Less Rounding**: Reduced border-radius across the app for a cleaner look:
  - Buttons: 8px → 6px with smaller padding
  - Inputs: 8px → 6px
  - Dropdown menus: 8px with compact items (8px 12px padding)
- **Navbar Dropdown**: Added visible outlined border to Profile Selector dropdown trigger.
- **Dropdown Styling**: Fixed invisible dropdown issue, added proper shadows and borders.
- **Compact Fonts**: Reduced font sizes across dropdowns and buttons (0.8125rem).


## [0.2.2] - 2026-01-08

### Fixed
- **PathBar Navigation**: Fixed invalid URL handling - now shows error toast and prevents navigation instead of loading existing buckets
- **Bucket Error Handling**: Added graceful error UI when bucket is not found, with helpful actions ("Back to Home" and "Try Again")
- **React Key Warnings**: Resolved React key prop warnings in PathBar autocomplete component
- **Console Logging**: Reduced console noise - fetch errors now only log in development mode with cleaner formatting
- **Copy Options**: Properly separated copy menu items:
  - **Copy Filename**: Copies just the filename with extension (e.g., `file.txt`)
  - **Copy Key**: Copies the S3 key path (e.g., `folder/subfolder/file.txt`)
  - **Copy S3 URI**: Copies full S3 URI (e.g., `s3://bucket-name/folder/file.txt`)
- **Page Scrolling**: Fixed overflow and scrolling issues in Recent and Favorites pages

### Changed
- **Layout Consistency**: Unified spacing across all pages:
  - Recent, Favorites, Downloads, Uploads now use full width (removed 800px maxWidth)
  - Reduced padding from `3` to `1` with top margin for consistency
  - All pages now have icon + title header layout (added StorageIcon to Buckets page)
  - Fixed scrolling behavior with proper flex and overflow properties
- **Main Content Spacing**: Added horizontal padding (px: 2) to main content area for better breathing room
- **PathBar UI**: Reduced search bar width (600px → 450px) and improved centering in navbar with balanced spacing

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
