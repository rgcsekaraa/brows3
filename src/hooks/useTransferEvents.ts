'use client';

import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { TransferEvent, TransferJob } from '@/lib/tauri';
import { isTauri } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

const REFRESH_INTERVAL_MS = 5000; // Refresh every 5 seconds

export function useTransferEvents() {
  const store = useTransferStore();
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
    if (!isTauri()) {
      return;
    }

    let cancelled = false;
    let unlistenUpdate: UnlistenFn | undefined;
    let unlistenAdded: UnlistenFn | undefined;
    isMounted.current = true;
    isVisibleRef.current = document.visibilityState === 'visible';
    const cleanupListeners = () => {
      unlistenUpdate?.();
      unlistenAdded?.();
      unlistenUpdate = undefined;
      unlistenAdded = undefined;
    };

    const setup = async () => {
      
      // Initial refresh on mount
      callbacksRef.current.refreshJobs();
      
      const stopUpdates = await listen<TransferEvent>('transfer-update', (event) => {
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

        if (!cancelled && (isVisibleRef.current || isTerminal)) {
          callbacksRef.current.updateJob(event.payload);
        }
      });
      
      if (cancelled) {
        stopUpdates();
        return;
      }
      unlistenUpdate = stopUpdates;
      const stopAdded = await listen<TransferJob>('transfer-added', (event) => {
        // Always process new jobs to ensure store is aware of them
        // This is generally lower frequency than progress updates
        if (!cancelled) {
          callbacksRef.current.upsertJob(event.payload);
        }
      });
      
      if (cancelled) {
        stopAdded();
        return;
      }
      unlistenAdded = stopAdded;
      if (isVisibleRef.current) startRefreshInterval();
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
    setup().catch(error => {
      cleanupListeners();
      if (!cancelled) console.error('Could not subscribe to transfer events:', error);
    });

    return () => {
      cancelled = true;
      isMounted.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupListeners();
      stopRefreshInterval();
    };
  }, []); // Empty deps - runs once on mount
}
