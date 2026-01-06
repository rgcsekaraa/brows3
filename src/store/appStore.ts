'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Tab {
  id: string;
  title: string;
  path: string;
  icon?: string;
}

type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  themeMode: ThemeMode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  
  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  
  // Actions
  setThemeMode: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  
  // Tab Actions
  addTab: (tab: Omit<Tab, 'id'>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      sidebarOpen: true,
      sidebarWidth: 280,
      
      tabs: [{ id: 'home', title: 'Buckets', path: '/', icon: 'cloud' }],
      activeTabId: 'home',
      
      setThemeMode: (themeMode) => set({ themeMode }),
      
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      
      addTab: (tab) => set((state) => {
        // Check if a tab with the same path already exists (deduplicate)
        const existingTab = state.tabs.find(t => t.path === tab.path);
        if (existingTab) {
          // Just switch to existing tab, don't create duplicate
          return { activeTabId: existingTab.id };
        }
        
        const id = Math.random().toString(36).substring(7);
        const newTab = { ...tab, id };
        return {
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        };
      }),
      
      removeTab: (id) => set((state) => {
        const newTabs = state.tabs.filter((t) => t.id !== id);
        let newActiveId = state.activeTabId;
        if (state.activeTabId === id) {
          newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        }
        return {
          tabs: newTabs,
          activeTabId: newActiveId,
        };
      }),
      
      setActiveTab: (activeTabId) => set({ activeTabId }),
      
      updateTab: (id, updates) => set((state) => ({
        tabs: state.tabs.map((t) => t.id === id ? { ...t, ...updates } : t)
      })),
    }),
    {
      name: 'brows3-app-v2', // Versioned name for new state structure
    }
  )
);
