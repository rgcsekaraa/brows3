'use client';

import { create } from 'zustand';

interface OpenBucket {
  name: string;
  region: string;
  prefix: string;
  openedAt: number;
}

interface TabStore {
  openBuckets: OpenBucket[];
  addBucket: (name: string, region: string, prefix?: string) => boolean; // returns false if already open
  removeBucket: (name: string) => void;
  updatePrefix: (name: string, prefix: string) => void;
  isOpen: (name: string) => boolean;
  getOpenBucket: (name: string) => OpenBucket | undefined;
}

export const useTabStore = create<TabStore>((set, get) => ({
  openBuckets: [],
  
  addBucket: (name, region, prefix = '') => {
    const existing = get().openBuckets.find(b => b.name === name);
    if (existing) {
      // Update prefix if different
      if (existing.prefix !== prefix) {
        set(state => ({
          openBuckets: state.openBuckets.map(b => 
            b.name === name ? { ...b, prefix } : b
          )
        }));
      }
      return false; // Already open
    }
    
    set(state => ({
      openBuckets: [...state.openBuckets, { name, region, prefix, openedAt: Date.now() }]
    }));
    return true; // Newly opened
  },
  
  removeBucket: (name) => {
    set(state => ({
      openBuckets: state.openBuckets.filter(b => b.name !== name)
    }));
  },
  
  updatePrefix: (name, prefix) => {
    set(state => ({
      openBuckets: state.openBuckets.map(b => 
        b.name === name ? { ...b, prefix } : b
      )
    }));
  },
  
  isOpen: (name) => {
    return get().openBuckets.some(b => b.name === name);
  },
  
  getOpenBucket: (name) => {
    return get().openBuckets.find(b => b.name === name);
  },
}));
