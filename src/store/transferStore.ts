import { create } from 'zustand';
import { TransferJob } from '@/lib/tauri';

interface TransferState {
  jobs: TransferJob[];
  isPanelOpen: boolean;
  isPanelHidden: boolean;
  addJob: (job: TransferJob) => void;
  upsertJob: (job: TransferJob) => void;
  updateJob: (event: { job_id: string; processed_bytes: number; total_bytes: number; status: TransferJob['status'] }) => void;
  setJobs: (jobs: TransferJob[]) => void;
  togglePanel: () => void;
  hidePanel: () => void;
  showPanel: () => void;
  
  // Actions
  refreshJobs: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

import { transferApi } from '@/lib/tauri';

export const useTransferStore = create<TransferState>((set, get) => ({
  jobs: [],
  isPanelOpen: false,
  isPanelHidden: false,
  
  addJob: (job) => set((state) => {
    // Prevent duplicates
    if (state.jobs.some(j => j.id === job.id)) return state;
    
    return { 
      jobs: [job, ...state.jobs],
      isPanelOpen: true 
    };
  }),
  
  // Upsert - add if not exists, update if exists
  upsertJob: (job) => set((state) => {
    const existingIndex = state.jobs.findIndex(j => j.id === job.id);
    if (existingIndex === -1) {
      // Add new job
      return { 
        jobs: [job, ...state.jobs],
        isPanelOpen: true 
      };
    }
    // Update existing
    const newJobs = [...state.jobs];
    newJobs[existingIndex] = { ...newJobs[existingIndex], ...job };
    return { jobs: newJobs };
  }),
  
  updateJob: (event) => set((state) => {
    const jobIndex = state.jobs.findIndex(j => j.id === event.job_id);
    
    if (jobIndex === -1) {
      // Job not found - this can happen due to race condition
      // Trigger a refresh to sync with backend
      setTimeout(() => get().refreshJobs(), 100);
      return state;
    }
    
    const job = state.jobs[jobIndex];
    // Skip update if nothing changed (prevents unnecessary re-renders)
    if (job.processed_bytes === event.processed_bytes && job.status === event.status) {
      return state;
    }
    
    // Create new array only if there's an actual change
    const newJobs = [...state.jobs];
    newJobs[jobIndex] = { 
      ...job, 
      processed_bytes: event.processed_bytes,
      total_bytes: event.total_bytes, 
      status: event.status 
    };
    return { jobs: newJobs };
  }),
  
  setJobs: (jobs) => set({ jobs }),
  
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  
  hidePanel: () => set({ isPanelHidden: true }),
  
  showPanel: () => set({ isPanelHidden: false, isPanelOpen: true }),
  
  refreshJobs: async () => {
    try {
      const jobs = await transferApi.listTransfers();
      set({ jobs });
    } catch (err) {
      console.error('Failed to refresh jobs:', err);
    }
  },
  
  cancelJob: async (id) => {
    await transferApi.cancelTransfer(id);
    get().refreshJobs();
  },
  
  retryJob: async (id) => {
    await transferApi.retryTransfer(id);
    get().refreshJobs();
  },
  
  removeJob: async (id) => {
    await transferApi.removeTransfer(id);
    set((state) => ({ jobs: state.jobs.filter(j => j.id !== id) }));
  },
  
  clearCompleted: async () => {
    await transferApi.clearCompletedTransfers();
    get().refreshJobs();
  }
}));

