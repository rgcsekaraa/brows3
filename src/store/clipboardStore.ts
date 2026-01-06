import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ClipboardItem {
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
    }
  )
);
