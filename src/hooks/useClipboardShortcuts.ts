'use client';

import { useEffect } from 'react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauri } from '@/lib/tauri';

/**
 * Hook to enable native-like clipboard operations in Tauri WebView
 * Intercepts Cmd/Ctrl+V and uses Tauri's clipboard manager to manually
 * insert text into the focused input, bypassing browser security blocks.
 */
export function useClipboardShortcuts() {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const isMod = e.metaKey || e.ctrlKey;
      
      if (!isMod) return;

      const key = e.key.toLowerCase();
      if (key !== 'v') return;

      // Paste is restricted in browsers, so we handle it manually for editable fields.
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) &&
        !activeElement.disabled &&
        !activeElement.readOnly
      ) {
        e.preventDefault();
        e.stopPropagation();

        try {
          const text = await readText();
          if (text !== null && text !== undefined) {
            const start = activeElement.selectionStart ?? activeElement.value.length;
            const end = activeElement.selectionEnd ?? activeElement.value.length;

            activeElement.setRangeText(text, start, end, 'end');
            activeElement.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              inputType: 'insertFromPaste',
              data: text,
            }));
          }
        } catch (err) {
          console.warn('Failed to read from clipboard:', err);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
