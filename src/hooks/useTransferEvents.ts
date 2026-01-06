'use client';

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TransferEvent } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

export function useTransferEvents() {
  const { updateJob } = useTransferStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Setup listener
    const setup = async () => {
      if (unlistenRef.current) return;
      
      const unlisten = await listen<TransferEvent>('transfer-update', (event) => {
        updateJob(event.payload);
      });
      
      unlistenRef.current = unlisten;
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
