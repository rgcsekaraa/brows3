import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { browserStorage } from './browserStorage';

interface SettingsState {
  defaultRegion: string;
  maxConcurrentTransfers: number;
  autoRefreshOnFocus: boolean;
  setDefaultRegion: (region: string) => void;
  setMaxConcurrentTransfers: (max: number) => void;
  setAutoRefreshOnFocus: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      defaultRegion: 'us-east-1',
      maxConcurrentTransfers: 5,
      autoRefreshOnFocus: false, // Disabled by default - can cause freezing on Ubuntu
      setDefaultRegion: (defaultRegion) => set({ defaultRegion }),
      setMaxConcurrentTransfers: (maxConcurrentTransfers) => set({ maxConcurrentTransfers }),
      setAutoRefreshOnFocus: (autoRefreshOnFocus) => set({ autoRefreshOnFocus }),
    }),
    {
      name: 'brows3-settings',
      storage: browserStorage,
    }
  )
);
