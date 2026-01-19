import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  defaultRegion: string;
  maxConcurrentTransfers: number;
  autoRefreshOnFocus: boolean;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setDefaultRegion: (region: string) => void;
  setMaxConcurrentTransfers: (max: number) => void;
  setAutoRefreshOnFocus: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      defaultRegion: 'us-east-1',
      maxConcurrentTransfers: 5,
      autoRefreshOnFocus: true,
      setTheme: (theme) => set({ theme }),
      setDefaultRegion: (defaultRegion) => set({ defaultRegion }),
      setMaxConcurrentTransfers: (maxConcurrentTransfers) => set({ maxConcurrentTransfers }),
      setAutoRefreshOnFocus: (autoRefreshOnFocus) => set({ autoRefreshOnFocus }),
    }),
    {
      name: 'brows3-settings',
    }
  )
);
