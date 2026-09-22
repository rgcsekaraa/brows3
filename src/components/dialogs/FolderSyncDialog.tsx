'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography, TextField, MenuItem } from '@mui/material';
import { FolderOpen } from '@mui/icons-material';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseDialog } from '@/components/common/BaseDialog';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';
import { syncApi, SyncPreview } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import { toast } from '@/store/toastStore';
import { formatSize } from '@/lib/utils';

interface Props { bucket: string; region?: string; prefix: string; profileId: string; onClose: () => void }

// The parent keys this dialog by destination and unmounts it on profile/navigation changes.
export default function FolderSyncDialog({ bucket, region, prefix, profileId, onClose }: Props) {
  const [folder, setFolder] = useState('');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'start' | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [skipExisting, setSkipExisting] = useState(false);
  function invalidatePreview() { setPreview(null); setConfirmed(false); setError(''); setPage(0); }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const replacements = (preview?.changed_files ?? 0) + (preview?.unverified_files ?? 0);
  const uploads = (preview?.new_files ?? 0) + replacements;
  const buttonSx = { borderRadius: '999px' };
  const secondarySx = { ...buttonSx, color: 'text.primary' };

  async function choose() {
    try {
      const path = await open({ directory: true, multiple: false, title: 'Choose a folder to sync' });
      if (alive.current && typeof path === 'string') { setFolder(path); setPreview(null); setConfirmed(false); setError(''); }
    } catch (e) { if (alive.current) setError(String(e)); }
  }
  async function compare() {
    setBusy('preview'); setError(''); setPreview(null); setConfirmed(false); setPage(0);
    try { const options = { include: include.split('\n').filter(line => line.length > 0), exclude: exclude.split('\n').filter(line => line.length > 0), skip_existing: skipExisting }; const result = await syncApi.preview(folder, bucket, region, prefix, profileId, options); if (alive.current) setPreview(result); }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(null); }
  }
  async function start() {
    if (!preview || busy) return;
    setBusy('start'); setError('');
    try {
      const count = await syncApi.start(preview.id, confirmed, profileId);
      void useTransferStore.getState().refreshJobs();
      toast.success(`${count} sync uploads queued. View progress in Uploads.`);
      if (alive.current) onClose();
    } catch (e) { if (alive.current) { setError(String(e)); setPreview(null); setConfirmed(false); } }
    finally { if (alive.current) setBusy(null); }
  }

  return <BaseDialog open title="Sync local folder to S3" onClose={() => { if (busy !== 'start') onClose(); }} maxWidth="md" actions={<>
    <Button size="small" sx={secondarySx} disabled={busy === 'start'} onClick={onClose}>Close</Button>
    <Button size="small" sx={secondarySx} variant="outlined" disabled={!folder || !!busy} onClick={compare}>{preview ? 'Refresh preview' : 'Preview changes'}</Button>
    <Button size="small" sx={buttonSx} variant="contained" disabled={!preview || !!busy || uploads === 0 || (replacements > 0 && !confirmed)} onClick={start}>Start sync</Button>
  </>}>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Copies this folder&apos;s contents into the destination below. Local files and remote-only objects are never deleted. Previewing makes no changes.</Typography>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
      <Button size="small" sx={{ ...secondarySx, flexShrink: 0 }} startIcon={<FolderOpen />} variant="outlined" disabled={!!busy} onClick={choose}>Choose folder</Button>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{folder || 'No local folder selected'}</Typography>
    </Box>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>Destination: s3://{bucket}/{prefix}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2, mb: 2 }}>
      <TextField label="Include patterns" size="small" multiline minRows={2} maxRows={4} disabled={!!busy} value={include} onChange={e => { setInclude(e.target.value); invalidatePreview(); }} helperText="One per line. Empty includes all files." />
      <TextField label="Exclude patterns" size="small" multiline minRows={2} maxRows={4} disabled={!!busy} value={exclude} onChange={e => { setExclude(e.target.value); invalidatePreview(); }} helperText="One per line. Exclusions take priority." />
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>Case-sensitive paths relative to the chosen folder. Use *.txt for its root, **/*.txt for all levels, or cache/** for a folder. Blank lines are ignored; spaces are literal.</Typography>
    <TextField select fullWidth size="small" label="Existing objects" value={skipExisting ? 'skip' : 'replace'} disabled={!!busy} onChange={e => { setSkipExisting(e.target.value === 'skip'); invalidatePreview(); }} sx={{ mb: 2 }}>
      <MenuItem value="replace">Replace changed files after confirmation</MenuItem>
      <MenuItem value="skip">Skip all existing objects</MenuItem>
    </TextField>
    {busy && <Box role="status" sx={{ mb: 2 }}><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>{busy === 'preview' ? 'Reading local files and comparing S3 objects. Large folders may take a few minutes.' : 'Queueing sync uploads...'}</Typography></Box>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {preview && <>
      <Typography variant="body2" sx={{ mb: 1 }}>{preview.new_files} new, {preview.changed_files} changed, {preview.unverified_files} unverified, {preview.unchanged_files} unchanged, {preview.filtered_files ?? 0} filtered, {preview.skipped_files ?? 0} skipped. Upload: {formatSize(preview.upload_bytes)}.</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{preview.remote_only_files} remote-only objects will be kept. Preview expires after 15 minutes.</Typography>
      {preview.unverified_files > 0 && <Alert severity="warning" sx={{ mb: 2 }}>Some objects have no comparable content hash, including multipart or KMS-encrypted objects. They will be uploaded again, even if their contents may match.</Alert>}
      {uploads === 0 && <Alert severity="success" sx={{ mb: 2 }}>{preview.entries.length ? 'No uploads are needed with these rules. Review the actions below.' : 'This local folder contains no files. Nothing to upload.'}</Alert>}
      {preview.entries.length > 0 && <Table size="small" aria-label="Sync preview" sx={{ tableLayout: 'fixed', width: '100%' }}>
        <TableHead><TableRow><TableCell>Object</TableCell><TableCell sx={{ width: 105 }}>Action</TableCell><TableCell align="right" sx={{ width: 90 }}>Size</TableCell></TableRow></TableHead>
        <TableBody>{preview.entries.slice(page * 50, (page + 1) * 50).map(entry => <TableRow key={entry.key}><TableCell sx={{ overflowWrap: 'anywhere' }}>{entry.key}</TableCell><TableCell>{entry.action}</TableCell><TableCell align="right">{formatSize(entry.size)}</TableCell></TableRow>)}</TableBody>
      </Table>}
      {preview.entries.length > 50 && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        <Button size="small" sx={buttonSx} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
        <Typography variant="body2">Page {page + 1} of {Math.ceil(preview.entries.length / 50)}</Typography>
        <Button size="small" sx={buttonSx} disabled={(page + 1) * 50 >= preview.entries.length} onClick={() => setPage(p => p + 1)}>Next</Button>
      </Box>}
      {replacements > 0 && <FormControlLabel sx={{ mt: 2, ml: 0, gap: 1, alignItems: 'flex-start' }} control={<StyledCheckbox aria-label="Confirm replacement of existing objects" checked={confirmed} onChange={e => { if (!busy) setConfirmed(e.target.checked); }} />} label={`Replace ${replacements} existing objects with these local files. Without bucket versioning, previous contents may not be recoverable.`} />}
    </>}
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Up to 10,000 local files. Symlinks are not followed. Uploads use temporary disk space to verify the previewed content. S3 request and transfer charges may apply.</Typography>
  </BaseDialog>;
}
