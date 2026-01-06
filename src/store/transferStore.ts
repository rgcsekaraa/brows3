import { create } from 'zustand';
import { TransferJob } from '@/lib/tauri';

interface TransferState {
  jobs: TransferJob[];
  isPanelOpen: boolean;
  addJob: (job: TransferJob) => void;
  updateJob: (event: { job_id: string; processed_bytes: number; total_bytes: number; status: TransferJob['status'] }) => void;
  setJobs: (jobs: TransferJob[]) => void;
  togglePanel: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  jobs: [],
  isPanelOpen: false,
  
  addJob: (job) => set((state) => ({ 
    jobs: [job, ...state.jobs],
    isPanelOpen: true // Open panel when adding a job
  })),
  
  updateJob: (event) => set((state) => ({
    jobs: state.jobs.map((job) => 
      job.id === event.job_id 
        ? { ...job, processed_bytes: event.processed_bytes, status: event.status }
        : job
    ),
  })),
  
  setJobs: (jobs) => set({ jobs }),
  
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
}));
