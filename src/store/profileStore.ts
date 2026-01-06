'use client';

import { create } from 'zustand';
import { Profile } from '@/lib/tauri';

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setProfiles: (profiles: Profile[]) => void;
  setActiveProfileId: (id: string | null) => void;
  addProfile: (profile: Profile) => void;
  updateProfile: (id: string, profile: Profile) => void;
  removeProfile: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProfileStore = create<ProfileState>()((set) => ({
  profiles: [],
  activeProfileId: null,
  isLoading: false,
  error: null,
  
  setProfiles: (profiles) => set({ profiles }),
  
  setActiveProfileId: (id) => set({ activeProfileId: id }),
  
  addProfile: (profile) => set((state) => ({ 
    profiles: [...state.profiles, profile] 
  })),
  
  updateProfile: (id, profile) => set((state) => ({
    profiles: state.profiles.map((p) => p.id === id ? profile : p)
  })),
  
  removeProfile: (id) => set((state) => ({
    profiles: state.profiles.filter((p) => p.id !== id),
    activeProfileId: state.activeProfileId === id ? null : state.activeProfileId
  })),
  
  setLoading: (isLoading) => set({ isLoading }),
  
  setError: (error) => set({ error }),
}));
