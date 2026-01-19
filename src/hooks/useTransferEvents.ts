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

  useEffect(() => {
    // Setup listener
    const setup = async () => {
      if (unlistenRef.current) return;
      
      // Initial refresh on mount
      callbacksRef.current.refreshJobs();
      
      const unlistenUpdate = await listen<TransferEvent>('transfer-update', (event) => {
        if (isMounted.current) callbacksRef.current.updateJob(event.payload);
      });
      
      const unlistenAdded = await listen<TransferJob>('transfer-added', (event) => {
         if (isMounted.current) callbacksRef.current.upsertJob(event.payload);
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
      
      // Periodic refresh to stay in sync
      refreshIntervalRef.current = setInterval(() => {
        if (isMounted.current) callbacksRef.current.refreshJobs();
      }, REFRESH_INTERVAL_MS);
    };

    setup();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, []); // Empty deps - runs once on mount
}


