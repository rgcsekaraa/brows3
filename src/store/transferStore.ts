import { create } from 'zustand';
import { TransferJob } from '@/lib/tauri';

interface TransferState {
  jobs: TransferJob[];
  jobsMap: Map<string, TransferJob>; // Internal map for O(1) access
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
  jobsMap: new Map(),
  isPanelOpen: false,
  isPanelHidden: false,
  
  addJob: (job) => set((state) => {
    if (state.jobsMap.has(job.id)) return state;
    
    const newMap = new Map(state.jobsMap);
    newMap.set(job.id, job);
    
    return { 
      jobsMap: newMap,
      jobs: [job, ...state.jobs],
      isPanelOpen: true 
    };
  }),
  
  upsertJob: (job) => set((state) => {
    const newMap = new Map(state.jobsMap);
    newMap.set(job.id, job);
    
    // Convert to array for compatibility (sorted by created_at)
    const newJobs = Array.from(newMap.values()).sort((a, b) => 
      (b.created_at || 0) - (a.created_at || 0)
    );
    
    return { 
      jobsMap: newMap,
      jobs: newJobs,
      isPanelOpen: true 
    };
  }),
  
  updateJob: (event) => set((state) => {
    const job = state.jobsMap.get(event.job_id);
    
    if (!job) {
      // Throttled refresh to prevent storm
      const stateAny = get() as any;
      if (!stateAny._isRefreshing) {
          stateAny._isRefreshing = true;
          setTimeout(() => {
             get().refreshJobs().finally(() => { stateAny._isRefreshing = false; });
          }, 500);
      }
      return state;
    }
    
    if (job.processed_bytes === event.processed_bytes && job.status === event.status) {
      return state;
    }
    
    const updatedJob = { 
      ...job, 
      processed_bytes: event.processed_bytes,
      total_bytes: event.total_bytes, 
      status: event.status 
    };
    
    const newMap = new Map(state.jobsMap);
    newMap.set(event.job_id, updatedJob);
    
    // Efficiently update the array without full sort if possible
    const newJobs = state.jobs.map(j => j.id === event.job_id ? updatedJob : j);
    
    return { 
      jobsMap: newMap,
      jobs: newJobs 
    };
  }),
  
  setJobs: (jobs) => set({ 
    jobs,
    jobsMap: new Map(jobs.map(j => [j.id, j]))
  }),
  
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  
  hidePanel: () => set({ isPanelHidden: true }),
  
  showPanel: () => set({ isPanelHidden: false, isPanelOpen: true }),
  
  refreshJobs: async () => {
    try {
      const jobs = await transferApi.listTransfers();
      set({ 
        jobs,
        jobsMap: new Map(jobs.map(j => [j.id, j]))
      });
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
    set((state) => {
      const newMap = new Map(state.jobsMap);
      newMap.delete(id);
      return {
        jobsMap: newMap,
        jobs: state.jobs.filter(j => j.id !== id)
      };
    });
  },
  
  clearCompleted: async () => {
    await transferApi.clearCompletedTransfers();
    get().refreshJobs();
  }
}));

