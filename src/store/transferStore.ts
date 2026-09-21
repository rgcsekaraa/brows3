import { create } from 'zustand';
import { TransferJob } from '@/lib/tauri';
import { transferApi } from '@/lib/tauri';

interface TransferState {
  jobs: TransferJob[];
  jobsMap: Map<string, TransferJob>; // Internal map for O(1) access
  isPanelOpen: boolean;
  isPanelHidden: boolean;
  addJob: (job: TransferJob) => void;
  upsertJob: (job: TransferJob) => void;
  updateJob: (event: { job_id: string; processed_bytes: number; total_bytes: number; status: TransferJob['status']; finished_at?: number }) => void;
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

let latestRefreshRequestId = 0;
let missingJobRefreshInProgress = false;

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
      isPanelOpen: true,
      isPanelHidden: false,
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
      isPanelOpen: true,
      isPanelHidden: false,
    };
  }),
  
  updateJob: (event) => set((state) => {
    const job = state.jobsMap.get(event.job_id);
    
    if (!job) {
      // Throttled refresh to prevent storm
      if (!missingJobRefreshInProgress) {
          missingJobRefreshInProgress = true;
          setTimeout(() => {
             get().refreshJobs().finally(() => { missingJobRefreshInProgress = false; });
          }, 500);
      }
      return state;
    }
    
    if (
      job.processed_bytes === event.processed_bytes &&
      job.total_bytes === event.total_bytes &&
      job.status === event.status &&
      job.finished_at === event.finished_at
    ) {
      return state;
    }
    
    const updatedJob = { 
      ...job, 
      processed_bytes: event.processed_bytes,
      total_bytes: event.total_bytes, 
      status: event.status,
      finished_at: event.finished_at,
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
    const requestId = ++latestRefreshRequestId;
    const before = get().jobsMap;
    try {
      const jobs = await transferApi.listTransfers();
      if (requestId !== latestRefreshRequestId) {
        return;
      }
      set(state => {
        const merged = new Map(jobs.map(job => [job.id, job]));
        // Events and removals after the request started are newer than its snapshot.
        for (const [id, job] of state.jobsMap) {
          if (job !== before.get(id)) merged.set(id, job);
        }
        for (const id of before.keys()) {
          if (!state.jobsMap.has(id)) merged.delete(id);
        }
        return {
          jobs: Array.from(merged.values()).sort((a, b) => b.created_at - a.created_at),
          jobsMap: merged,
        };
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
