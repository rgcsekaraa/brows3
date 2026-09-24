'use client';
import { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Edit, DeleteOutline } from '@mui/icons-material';
import { TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import UrlImportDialog from '@/components/dialogs/UrlImportDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export default function UrlImportActions({ job }: { job: TransferJob }) {
  const [edit, setEdit] = useState(false), [remove, setRemove] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!job.url_import) return null;
  const terminal = job.status === 'Completed' || job.status === 'Cancelled' || typeof job.status === 'object';
  return <>
    {terminal && job.status !== 'Completed' && <Tooltip title="Edit source and retry"><IconButton size="small" aria-label="Edit import source" onClick={() => setEdit(true)}><Edit fontSize="small" /></IconButton></Tooltip>}
    {terminal && <Tooltip title="Remove from list"><IconButton size="small" aria-label="Remove import from list" onClick={() => { setError(''); setRemove(true); }}><DeleteOutline fontSize="small" /></IconButton></Tooltip>}
    {edit && <UrlImportDialog bucket={job.bucket} region={job.bucket_region || undefined} prefix="" initialPath={job.key} initialLimits={job.url_import} profileId={job.profile_id} onClose={() => setEdit(false)} />}
    <ConfirmDialog open={remove} title="Remove transfer from list?" message={<>This removes the history entry only. The file in S3 will not be deleted.{error && <span role="alert">{error}</span>}</>} confirmLabel="Remove from list" isLoading={busy} onClose={() => { if (!busy) setRemove(false); }} onConfirm={async () => {
      if (busy) return; setBusy(true);
      try { await useTransferStore.getState().removeJob(job.id); setRemove(false); } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }} />
  </>;
}
