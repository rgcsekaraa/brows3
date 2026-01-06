'use client';

import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  autoHide?: boolean;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => set((state) => ({
    toasts: [
      ...state.toasts,
      {
        ...toast,
        id: Math.random().toString(36).substring(7),
        autoHide: toast.autoHide ?? (toast.type !== 'error'),
        duration: toast.duration ?? 5000,
      },
    ],
  })),
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
  clearToasts: () => set({ toasts: [] }),
}));

// Helper functions for easy usage
export const toast = {
  success: (message: string, details?: string) => 
    useToastStore.getState().addToast({ type: 'success', message, details }),
  error: (message: string, details?: string) => 
    useToastStore.getState().addToast({ type: 'error', message, details, autoHide: false }),
  warning: (message: string, details?: string) => 
    useToastStore.getState().addToast({ type: 'warning', message, details }),
  info: (message: string, details?: string) => 
    useToastStore.getState().addToast({ type: 'info', message, details }),
};
