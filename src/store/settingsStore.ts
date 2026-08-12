import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { browserStorage } from './browserStorage';

export const MIN_TEXT_PREVIEW_SIZE_MB = 1;
export const MAX_TEXT_PREVIEW_SIZE_MB = 100;

interface SettingsState {
  defaultRegion: string;
  maxConcurrentTransfers: number;
  maxTextPreviewSizeMb: number;
  autoRefreshOnFocus: boolean;
  setDefaultRegion: (region: string) => void;
  setMaxConcurrentTransfers: (max: number) => void;
  setMaxTextPreviewSizeMb: (max: number) => void;
  setAutoRefreshOnFocus: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      defaultRegion: 'us-east-1',
      maxConcurrentTransfers: 5,
      maxTextPreviewSizeMb: 2,
      autoRefreshOnFocus: false, // Disabled by default - can cause freezing on Ubuntu
      setDefaultRegion: (defaultRegion) => set({ defaultRegion }),
      setMaxConcurrentTransfers: (maxConcurrentTransfers) => set({ maxConcurrentTransfers }),
      setMaxTextPreviewSizeMb: (value) => set({
        maxTextPreviewSizeMb: Math.min(
          MAX_TEXT_PREVIEW_SIZE_MB,
          Math.max(MIN_TEXT_PREVIEW_SIZE_MB, Math.round(value))
        ),
      }),
      setAutoRefreshOnFocus: (autoRefreshOnFocus) => set({ autoRefreshOnFocus }),
    }),
    {
      name: 'brows3-settings',
      storage: browserStorage,
    }
  )
);
