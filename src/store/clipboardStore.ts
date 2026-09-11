import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { browserStorage } from './browserStorage';

export interface ClipboardItem {
  profileId: string;
  bucket: string;
  region: string;
  key: string;
  isFolder: boolean;
}

interface ClipboardState {
  items: ClipboardItem[];
  mode: 'copy' | 'move';
  copy: (items: ClipboardItem[]) => void;
  cut: (items: ClipboardItem[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>()(
  persist(
    (set) => ({
      items: [],
      mode: 'copy',
      copy: (items) => set({ items, mode: 'copy' }),
      cut: (items) => set({ items, mode: 'move' }),
      clear: () => set({ items: [], mode: 'copy' }),
    }),
    {
      name: 'brows3-clipboard',
      version: 1,
      migrate: () => ({ items: [], mode: 'copy' as const }),
      storage: browserStorage,
    }
  )
);
