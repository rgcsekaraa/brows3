'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentItem {
  key: string;           // Full S3 key
  name: string;          // Display name
  bucket: string;
  region: string;
  isFolder: boolean;
  accessedAt: number;    // Timestamp
}

export interface FavoriteItem {
  key: string;
  name: string;
  bucket: string;
  region: string;
  isFolder: boolean;
  addedAt: number;
}

interface HistoryState {
  recentItems: RecentItem[];
  favorites: FavoriteItem[];
  
  // Recent
  addRecent: (item: Omit<RecentItem, 'accessedAt'>) => void;
  clearRecent: () => void;
  
  // Favorites
  addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => void;
  removeFavorite: (key: string, bucket: string) => void;
  isFavorite: (key: string, bucket: string) => boolean;
  clearFavorites: () => void;
}

const MAX_RECENT = 50;

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      recentItems: [],
      favorites: [],
      
      addRecent: (item) => set((state) => {
        // Remove duplicate if exists
        const filtered = state.recentItems.filter(
          r => !(r.key === item.key && r.bucket === item.bucket)
        );
        // Add to front with timestamp
        const newRecent = [
          { ...item, accessedAt: Date.now() },
          ...filtered,
        ].slice(0, MAX_RECENT);
        
        return { recentItems: newRecent };
      }),
      
      clearRecent: () => set({ recentItems: [] }),
      
      addFavorite: (item) => set((state) => {
        // Check if already exists
        const exists = state.favorites.some(
          f => f.key === item.key && f.bucket === item.bucket
        );
        if (exists) return state;
        
        return {
          favorites: [{ ...item, addedAt: Date.now() }, ...state.favorites],
        };
      }),
      
      removeFavorite: (key, bucket) => set((state) => ({
        favorites: state.favorites.filter(
          f => !(f.key === key && f.bucket === bucket)
        ),
      })),
      
      isFavorite: (key, bucket) => {
        return get().favorites.some(f => f.key === key && f.bucket === bucket);
      },
      
      clearFavorites: () => set({ favorites: [] }),
    }),
    {
      name: 'brows3-history',
    }
  )
);
