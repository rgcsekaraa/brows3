'use client';

import { useEffect } from 'react';

/**
 * Hook to enable native-like clipboard operations in Tauri WebView
 * This intercepts Cmd/Ctrl+C/V/X/A and uses the browser's execCommand
 * which works with the Tauri WebView clipboard
 */
export function useClipboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const isMod = e.metaKey || e.ctrlKey;
      
      if (!isMod) return;
      
      switch (e.key.toLowerCase()) {
        case 'c':
          // Copy - use document.execCommand for webview compatibility
          document.execCommand('copy');
          break;
        case 'x':
          // Cut
          document.execCommand('cut');
          break;
        case 'v':
          // Paste
          document.execCommand('paste');
          break;
        case 'a':
          // Select All
          document.execCommand('selectAll');
          break;
        case 'z':
          if (e.shiftKey) {
            // Redo
            document.execCommand('redo');
          } else {
            // Undo
            document.execCommand('undo');
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
