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
    // Check if job exists
    const exists = state.jobs.some(j => j.id === event.job_id);
    if (!exists) {
        // If not found, we should probably trigger a refresh, but we can't do it async in reducer easily
        // For now, we rely on manual refresh/add
        return state;
    }
    
    return {
      jobs: state.jobs.map((job) => 
        job.id === event.job_id 
          ? { ...job, processed_bytes: event.processed_bytes, status: event.status }
          : job
      ),
    };
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
