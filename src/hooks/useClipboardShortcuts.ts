'use client';

import { useEffect } from 'react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Hook to enable native-like clipboard operations in Tauri WebView
 * Intercepts Cmd/Ctrl+V and uses Tauri's clipboard manager to manually
 * insert text into the focused input, bypassing browser security blocks.
 */
export function useClipboardShortcuts() {
  useEffect(() => {
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
        (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)
      ) {
        try {
          const text = await readText();
          if (text) {
            const start = activeElement.selectionStart || 0;
            const end = activeElement.selectionEnd || 0;
            const value = activeElement.value;
            
            activeElement.value = value.substring(0, start) + text + value.substring(end);
            
            // Set cursor position after the pasted text
            const newPos = start + text.length;
            activeElement.setSelectionRange(newPos, newPos);
            
            // Trigger input event for React/form libraries
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Stop default browser behavior
            e.preventDefault();
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
