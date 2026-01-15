'use client';

import { loader } from '@monaco-editor/react';

// Determine if we're in production/Tauri environment
const isProduction = typeof window !== 'undefined' && (
  process.env.NODE_ENV === 'production' ||
  '__TAURI__' in window
);

// Configure Monaco to load from local bundle in production, CDN in development
// This ensures offline capability in packaged Tauri apps across all OS
loader.config({
  paths: {
    // In production, use locally bundled Monaco files
    // In development, use CDN for faster HMR
    vs: isProduction 
      ? '/monaco-editor/min/vs'  // Local files from public folder
      : 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs'
  },
  'vs/nls': {
    availableLanguages: {
      '*': 'en'
    }
  }
});

// Pre-load Monaco to avoid loading delay on first editor open
let monacoPreloaded = false;

export const preloadMonaco = () => {
  if (monacoPreloaded) return;
  monacoPreloaded = true;
  
  // Initialize Monaco in background
  loader.init().then((monaco) => {
    console.log('Monaco Editor preloaded successfully');
  }).catch((err) => {
    console.warn('Monaco preload failed, will load on demand:', err);
  });
};

// Export loader for any additional configuration needs
export { loader };
