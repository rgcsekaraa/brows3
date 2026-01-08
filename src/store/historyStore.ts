
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Recent item type for folder navigation history
export interface RecentItem {
  key: string;
  name: string;
  bucket: string;
  region?: string;
  isFolder: boolean;
  timestamp?: number;
}

export type FavoriteItem = RecentItem;

interface HistoryState {
  recentPaths: string[]; // For TopBar autocomplete
  recentItems: RecentItem[]; // For inner navigation history
  
  addPath: (path: string) => void;
  addRecent: (item: RecentItem) => void; // New method for bucket/page.tsx
  clearHistory: () => void;
  
  // Stubs for Favorites (used in page.tsx too)
  favorites: RecentItem[];
  addFavorite: (item: RecentItem) => void;
  removeFavorite: (key: string) => void;
  isFavorite: (key: string) => boolean;
  clearFavorites: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      recentPaths: [],
      recentItems: [],
      favorites: [],
      
      addPath: (path) => set((state) => {
        // Remove duplicates and keep only last 20
        const filtered = state.recentPaths.filter(p => p !== path);
        return { recentPaths: [path, ...filtered].slice(0, 20) };
      }),
      
      addRecent: (item) => set((state) => {
        // Similar dedupe logic for items
        const newItem = { ...item, timestamp: Date.now() };
        const filtered = state.recentItems.filter(i => i.key !== item.key);
        return { recentItems: [newItem, ...filtered].slice(0, 50) };
      }),
      
      addFavorite: (item) => set((state) => ({ 
        favorites: [...state.favorites, item] 
      })),
      
      removeFavorite: (key) => set((state) => ({ 
        favorites: state.favorites.filter(i => i.key !== key) 
      })),
      
      isFavorite: (key) => get().favorites.some(i => i.key === key),
      
      clearFavorites: () => set({ favorites: [] }),

      clearHistory: () => set({ recentPaths: [], recentItems: [] }),
    }),
    {
      name: 'brows3-history',
    }
  )
);
