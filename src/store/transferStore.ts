import { create } from 'zustand';
import { TransferJob } from '@/lib/tauri';

interface TransferState {
  jobs: TransferJob[];
  isPanelOpen: boolean;
  addJob: (job: TransferJob) => void;
  updateJob: (event: { job_id: string; processed_bytes: number; total_bytes: number; status: TransferJob['status'] }) => void;
  setJobs: (jobs: TransferJob[]) => void;
  togglePanel: () => void;
  
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
  
  addJob: (job) => set((state) => {
    // Prevent duplicates
    if (state.jobs.some(j => j.id === job.id)) return state;
    
    return { 
      jobs: [job, ...state.jobs],
      isPanelOpen: true 
    };
  }),
  
  updateJob: (event) => set((state) => {
    const jobIndex = state.jobs.findIndex(j => j.id === event.job_id);
    if (jobIndex === -1) return state; // Job not found
    
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
      status: event.status 
    };
    return { jobs: newJobs };
  }),
  
  setJobs: (jobs) => set({ jobs }),
  
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  
  refreshJobs: async () => {
    const jobs = await transferApi.listTransfers();
    set({ jobs });
  },
  
  cancelJob: async (id) => {
    await transferApi.cancelTransfer(id);
    // Optimistic update? Or wait for event? event will come.
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
