
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Recent item type for folder navigation history
export interface RecentItem {
  key: string;
  name: string;
  bucket: string;
  region?: string;
  profileId?: string;
  isFolder: boolean;
  timestamp?: number;
}

export type FavoriteItem = RecentItem;

interface HistoryState {
  recentPaths: string[]; // For TopBar autocomplete
  recentItems: RecentItem[]; // For inner navigation history
  
  addPath: (path: string) => void;
  addRecent: (item: RecentItem) => void; // New method for bucket/page.tsx
  clearRecent: () => void;
  clearHistory: () => void;
  
  // Stubs for Favorites (used in page.tsx too)
  favorites: RecentItem[];
  addFavorite: (item: RecentItem) => void;
  removeFavorite: (key: string, bucket?: string, profileId?: string) => void;
  isFavorite: (key: string, bucket?: string, profileId?: string) => boolean;
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
        const filtered = state.recentItems.filter(i => !(
          i.key === item.key &&
          i.bucket === item.bucket &&
          i.region === item.region &&
          i.profileId === item.profileId
        ));
        return { recentItems: [newItem, ...filtered].slice(0, 50) };
      }),
      
      addFavorite: (item) => set((state) => {
        // Prevent duplicates - check by key, bucket, region, and profile
        const exists = state.favorites.some(i =>
          i.key === item.key &&
          i.bucket === item.bucket &&
          i.region === item.region &&
          i.profileId === item.profileId
        );
        if (exists) return state;
        return { favorites: [...state.favorites, item] };
      }),
      
      removeFavorite: (key, bucket, profileId) => set((state) => ({ 
        favorites: state.favorites.filter(i => !(
          i.key === key &&
          (bucket ? i.bucket === bucket : true) &&
          (profileId ? i.profileId === profileId : true)
        )) 
      })),
      
      isFavorite: (key, bucket, profileId) => get().favorites.some(i =>
        i.key === key &&
        (bucket ? i.bucket === bucket : true) &&
        (profileId ? i.profileId === profileId : true)
      ),
      
      clearFavorites: () => set({ favorites: [] }),

      clearRecent: () => set({ recentItems: [] }),

      clearHistory: () => set({ recentPaths: [], recentItems: [] }),
    }),
    {
      name: 'brows3-history',
    }
  )
);
