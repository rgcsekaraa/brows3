'use client';

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TransferEvent, TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

const REFRESH_INTERVAL_MS = 5000; // Refresh every 5 seconds

export function useTransferEvents() {
  const store = useTransferStore();
  const unlistenRef = useRef<(() => void) | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef(true);
  
  // Use refs to store latest callbacks without triggering effect re-runs
  const callbacksRef = useRef({
    updateJob: store.updateJob,
    upsertJob: store.upsertJob,
    refreshJobs: store.refreshJobs,
  });
  
  const isMounted = useRef(true);

  useEffect(() => {
    // Keep refs in sync
    callbacksRef.current = {
      updateJob: store.updateJob,
      upsertJob: store.upsertJob,
      refreshJobs: store.refreshJobs,
    };
    
    return () => { isMounted.current = false; };
  }, [store.updateJob, store.upsertJob, store.refreshJobs]);

  // Manage refresh interval based on visibility
  const startRefreshInterval = () => {
    if (refreshIntervalRef.current) return;
    refreshIntervalRef.current = setInterval(() => {
      if (isMounted.current && isVisibleRef.current) {
        callbacksRef.current.refreshJobs();
      }
    }, REFRESH_INTERVAL_MS);
  };

  const stopRefreshInterval = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  };

  useEffect(() => {
    // Setup listener
    const setup = async () => {
      if (unlistenRef.current) return;
      
      // Initial refresh on mount
      callbacksRef.current.refreshJobs();
      
      const unlistenUpdate = await listen<TransferEvent>('transfer-update', (event) => {
        // Smart Throttling:
        // 1. If visible: Process everything
        // 2. If hidden: Only process "terminal" states (Completed, Failed, Cancelled)
        //    This ensures we don't miss completion notifications while avoiding 
        //    high-frequency progress updates consuming CPU in background.
        
        const status = event.payload.status;
        const isTerminal = 
          status === 'Completed' || 
          status === 'Cancelled' || 
          (typeof status === 'object' && 'Failed' in status);

        if (isMounted.current && (isVisibleRef.current || isTerminal)) {
          callbacksRef.current.updateJob(event.payload);
        }
      });
      
      const unlistenAdded = await listen<TransferJob>('transfer-added', (event) => {
        // Always process new jobs to ensure store is aware of them
        // This is generally lower frequency than progress updates
        if (isMounted.current) {
          callbacksRef.current.upsertJob(event.payload);
        }
      });
      
      if (!isMounted.current) {
          unlistenUpdate();
          unlistenAdded();
          return;
      }
      
      unlistenRef.current = () => {
          unlistenUpdate();
          unlistenAdded();
      };
      
      // Start periodic refresh only when visible
      startRefreshInterval();
    };

    // Handle visibility change - pause processing when not visible
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      
      if (isVisibleRef.current) {
        // App became visible - refresh once and restart interval
        callbacksRef.current.refreshJobs();
        startRefreshInterval();
      } else {
        // App hidden - stop interval to prevent background processing
        stopRefreshInterval();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    setup();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      stopRefreshInterval();
    };
  }, []); // Empty deps - runs once on mount
}
