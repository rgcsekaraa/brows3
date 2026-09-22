# Preview selection and navigation

Preview files and build a selection without closing the dialog. The Select/Selected toggle shares the bucket table's selection state, so selection persists after closing the preview. Selection and navigation do not automatically download, copy, move, delete, or save files.

## Ordering and pagination

Previous and Next follow the table's current sorting and filtering across a mixed sequence of previewable files. Folders and unsupported files are skipped; duplicate object keys appear once. Navigation does not wrap. The position counter describes currently loaded previewable files, not the total number of objects in the bucket.

At the end of the loaded sequence, Next can fetch additional listing pages. Each attempt searches at most 20 pages, including pages containing only unsupported files or folders. Navigation is serialized within the active preview context. The dialog reports loading and errors; Next can retry a failed request or continue after the 20-page limit. A repeated continuation cursor prompts a folder refresh. Deep search navigates its supplied results without this listing pagination.

Context identity guards prevent completed requests from navigating a closed preview or applying navigation to a different object, folder, sort, or search context.

## Controls and draft protection

- Left and Right move between previews; Space toggles file selection. Space on a focused button retains the button's native activation.
- Text inputs, editable content, Monaco, embedded documents, and native audio/video controls retain their keyboard behavior instead of triggering generic preview shortcuts.
- In the image viewer, Shift plus arrow keys pans while Left and Right switch previews. Scroll or pinch zooms; drag pans; plus/minus zoom, `0` fits, and `1` shows actual size.
- Editing or saving blocks file navigation. Closing or canceling an edit with unsaved changes requires choosing Discard changes or Keep editing. Closing is blocked during saving.
- Draft state compares edited text with the loaded or saved content baseline. Undoing back to that baseline or discarding a draft clears the dirty state, even when Monaco has assigned a new model version.

## Implementation and visual authority

The existing image viewer and BaseDialog remain authoritative. Preserve their light/dark theme, image zoom and pan, and compact rounded controls. Selection and navigation extend these surfaces; this feature does not establish a new visual design system.

| Source | Responsibility |
| --- | --- |
| `src/hooks/usePreviewNavigation.ts` | Previewable sequence, boundaries, bounded pagination, retry feedback, and stale-result guards |
| `src/lib/objectSort.ts` | Shared table and preview comparison for name, size, date, and storage class |
| `src/components/dialogs/ObjectPreviewDialog.tsx` | Mixed file previews, selection controls, keyboard exclusions, editing and discard protection |
| `src/components/dialogs/ImagePreviewViewer.tsx` | Existing image rendering, zoom and pan, plus selection and navigation controls |
| `src/app/bucket/page.tsx` | Current table data, sorting/search context, pagination, and persistent selection wiring |

Selection/navigation and shared sorting are adapted from Anton Piotukh (@antonp2k), [PR #39](https://github.com/rgcsekaraa/brows3/pull/39). The existing image viewer is retained rather than importing the older slider viewer.
