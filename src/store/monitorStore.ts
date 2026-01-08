import { create } from 'zustand';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'error';
  message: string;
  details?: string;
}

interface MonitorState {
  logs: LogEntry[];
  metrics: {
    totalRequests: number;
    failedRequests: number;
    lastRequestTime: number | null;
  };
  addLog: (type: LogEntry['type'], message: string, details?: string) => void;
  incrementRequests: () => void;
  incrementFailures: () => void;
  clearLogs: () => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  logs: [],
  metrics: {
    totalRequests: 0,
    failedRequests: 0,
    lastRequestTime: null,
  },
  addLog: (type, message, details) => set((state) => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      type,
      message,
      details,
    };
    // Keep last 100 logs
    const newLogs = [newLog, ...state.logs].slice(0, 100);
    return { logs: newLogs };
  }),
  incrementRequests: () => set((state) => ({
    metrics: {
      ...state.metrics,
      totalRequests: state.metrics.totalRequests + 1,
      lastRequestTime: Date.now(),
    }
  })),
  incrementFailures: () => set((state) => ({
    metrics: {
      ...state.metrics,
      failedRequests: state.metrics.failedRequests + 1,
    }
  })),
  clearLogs: () => set({ 
    logs: [], 
    metrics: { totalRequests: 0, failedRequests: 0, lastRequestTime: null } 
  }),
}));
