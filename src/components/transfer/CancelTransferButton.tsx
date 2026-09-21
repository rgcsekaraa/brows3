'use client';

import { useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Cancel } from '@mui/icons-material';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type { TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

export function CancelTransferButton({ job }: { job: TransferJob }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const active = job.status === 'Pending' || job.status === 'InProgress';
  const direction = job.transfer_type.toLowerCase();
  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const store = useTransferStore.getState();
      const latest = store.jobsMap.get(job.id);
      if (latest && (latest.status === 'Pending' || latest.status === 'InProgress')) {
        await store.cancelJob(job.id);
      }
      setOpen(false);
    } catch (cause) {
      setError(`Could not cancel the ${direction}. ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <>
    <Tooltip title={active ? 'Cancel' : ''}>
      <span><IconButton aria-label={`Cancel ${direction}`} size="small" color="error" disabled={!active} onClick={() => { setError(''); setOpen(true); }} sx={{ borderRadius: '50%' }}><Cancel fontSize="small" /></IconButton></span>
    </Tooltip>
    <ConfirmDialog open={open} onClose={() => { if (!pending.current) setOpen(false); }} onConfirm={confirm}
      title={`Cancel ${direction}?`} confirmLabel={`Cancel ${direction}`} cancelLabel="Keep transferring"
      isDestructive isLoading={busy}
      message={<>{`Stop ${direction === 'upload' ? 'uploading' : 'downloading'} "${job.key}"? You can retry it later.`}{error && <span role="alert" style={{ display: 'block' }}>{error}</span>}</>} />
  </>;
}
