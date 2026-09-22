'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { ClipboardItem } from '@/store/clipboardStore';
import { useProfileStore } from '@/store/profileStore';
import { useTransferStore } from '@/store/transferStore';
import { operationsApi } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

interface Props { items: ClipboardItem[]; bucket: string; region: string; prefix: string; profileId: string; onClose: () => void }

export default function CrossProfileCopyDialog({ items, bucket, region, prefix, profileId, onClose }: Props) {
  const profiles = useProfileStore(state => state.profiles);
  const source = profiles.find(p => p.id === items[0]?.profileId);
  const destination = profiles.find(p => p.id === profileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function start() {
    if (pending.current || !source || !destination) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const count = await operationsApi.copyBetweenProfiles(items, bucket, region, prefix, profileId);
      void useTransferStore.getState().refreshJobs();
      toast.success(count ? `${count} copies queued. View progress in Uploads.` : 'The selected folders contain no objects. Nothing was queued.');
      if (alive.current) onClose();
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const buttonSx = { borderRadius: '999px' };
  return <BaseDialog open title="Copy between profiles" onClose={onClose} closeDisabled={busy} actions={<>
    <Button size="small" sx={{ ...buttonSx, color: 'text.primary' }} disabled={busy} onClick={onClose}>Cancel</Button>
    <Button size="small" sx={buttonSx} variant="contained" disabled={busy || !source || !destination} onClick={start}>Copy to destination</Button>
  </>}>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>From: {source?.name || 'Source profile unavailable'}</Typography>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>To: {destination?.name || 'Destination profile unavailable'} / s3://{bucket}/{prefix}</Typography>
    <Typography variant="body2">{items.length} selected {items.length === 1 ? 'item' : 'items'}. Folders include their contents.</Typography>
    <Box component="ul" sx={{ pl: 2.5, my: 1, overflowWrap: 'anywhere' }}>{items.slice(0, 5).map(item => <Typography component="li" variant="body2" key={`${item.bucket}/${item.key}`}>s3://{item.bucket}/{item.key}</Typography>)}</Box>
    {items.length > 5 && <Typography variant="body2" color="text.secondary">And {items.length - 5} more selected items.</Typography>}
    <Alert severity="info" sx={{ my: 2 }}>Source objects stay unchanged. Existing destination objects will fail safely without replacement. Copies use this computer&apos;s connection and temporary disk space. S3 request and transfer charges may apply.</Alert>
    <Typography variant="body2" color="text.secondary">Copies contents and content metadata only, not tags, permissions, version history or retention settings. Destination defaults control encryption and storage class.</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Up to 10,000 objects per batch. Progress in Uploads includes both download and upload bytes. Cancel queued or running copies there; completed copies remain.</Typography>
    {(!source || !destination) && <Alert severity="error" sx={{ mt: 2 }}>A profile is no longer available. Close this dialog and copy the items again.</Alert>}
    {busy && <Box role="status" sx={{ mt: 2 }}><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>Checking source objects and queueing copies. Large selections can take a few minutes.</Typography></Box>}
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
  </BaseDialog>;
}
