'use client';

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TransferEvent, TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

export function useTransferEvents() {
  const { updateJob, addJob } = useTransferStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Setup listener
    const setup = async () => {
      if (unlistenRef.current) return;
      
      const unlistenUpdate = await listen<TransferEvent>('transfer-update', (event) => {
        updateJob(event.payload);
      });
      
      const unlistenAdded = await listen<TransferJob>('transfer-added', (event) => {
        addJob(event.payload);
      });
      
      unlistenRef.current = () => {
          unlistenUpdate();
          unlistenAdded();
      };
    };

    setup();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [updateJob]);
}
