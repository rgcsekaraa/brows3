'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Divider, Typography } from '@mui/material';
import { Schedule } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { jobsApi, SavedJob } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { BaseDialog } from '@/components/common/BaseDialog';

const buttonSx = { borderRadius: '999px', color: 'text.primary' };
const date = (time: number) => new Date(time * 1000).toLocaleString();

export default function JobsPage() {
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<SavedJob | null>(null);
  const [cancelling, setCancelling] = useState<SavedJob | null>(null);
  const profiles = useProfileStore(state => state.profiles);
  const router = useRouter();
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try { const result = await jobsApi.list(); if (alive.current) { setJobs(result); setError(''); } }
    catch (e) { if (alive.current) setError(String(e)); }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); }
    void poll();
    return () => { alive.current = false; stopped = true; clearTimeout(timer); };
  }, [refresh]);
  const [actionError, setActionError] = useState('');
  const actionLock = useRef(false);
  async function act(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError('');
    try { await action(); if (alive.current) { setDeleting(null); setCancelling(null); await refresh(); } }
    catch (e) { if (alive.current) setActionError(String(e)); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  return <Box sx={{ p: 1, mt: 1, minWidth: 0 }}>
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}><Schedule color="primary" /><Typography variant="h4" component="h1" fontWeight={700}>Jobs</Typography></Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: '75ch' }}>Saved folder-to-S3 syncs across your profiles. Runs only while Brows3 is open. Missed runs while closed, interrupted runs, and failures pause their schedules. Files and remote-only objects are never deleted.</Typography>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
      <Button size="small" sx={buttonSx} variant="outlined" onClick={() => router.push('/')}>Browse buckets</Button>
      <Button size="small" sx={buttonSx} onClick={() => router.push('/uploads')}>View uploads</Button>
      <Button size="small" sx={buttonSx} disabled={busy} onClick={() => void refresh()}>Refresh jobs</Button>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>To add a job, open a bucket and choose Upload, Sync local folder, then Save as a job. To change a configuration, delete it and save a new one. Pause stops future runs; cancel queued or active transfers in Uploads.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {actionError && !deleting && !cancelling && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
    {!jobs && !error && <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><CircularProgress size={18} />Loading jobs...</Box>}
    {jobs?.length === 0 && <Typography sx={{ py: 3 }}>No saved jobs yet. Save a folder sync to repeat it here.</Typography>}
    {jobs?.map(job => {
      const active = !!job.last_run && job.last_run.finished_at === null;
      const profile = profiles.find(p => p.id === job.config.profile_id);
      return <Box component="section" aria-label={job.config.name} key={job.id} sx={{ py: 2, borderTop: '1px solid', borderColor: 'divider', overflowWrap: 'anywhere' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <Box sx={{ minWidth: 0 }}><Typography variant="h6" component="h2">{job.config.name}</Typography><Typography variant="body2" color="text.secondary">{profile?.name ?? 'Profile unavailable'} · {job.config.interval_minutes ? `Every ${job.config.interval_minutes} minutes after completion` : 'Manual only'}{job.config.interval_minutes && !job.enabled ? ' · Paused' : ''}</Typography></Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="small" sx={buttonSx} variant="outlined" disabled={busy || active || !profile} onClick={() => void act(() => jobsApi.run(job.id))}>Run now</Button>
            {active && <Button size="small" sx={buttonSx} disabled={busy || job.last_run?.cancel_requested} onClick={() => { setActionError(''); setCancelling(job); }}>{job.last_run?.cancel_requested ? 'Cancelling...' : 'Cancel run'}</Button>}
            {job.config.interval_minutes && <Button size="small" sx={buttonSx} disabled={busy || (!job.enabled && !profile)} onClick={() => void act(() => jobsApi.setEnabled(job.id, !job.enabled))}>{job.enabled ? 'Pause' : 'Resume'}</Button>}
            <Button size="small" sx={buttonSx} disabled={busy || active} onClick={() => { setActionError(''); setDeleting(job); }}>Delete</Button>
          </Box>
        </Box>
        <Typography variant="body2">{job.config.local_path}</Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>To s3://{job.config.bucket}/{job.config.prefix}</Typography>
        <Typography variant="body2" color="text.secondary">{job.config.options.skip_existing ? 'Skip existing objects' : 'Replace changed or unverified objects'} · {job.config.bandwidth ? `${job.config.bandwidth / 1024} KiB/s per transfer` : 'Unlimited bandwidth'}</Typography>
        {(job.config.options.include.length > 0 || job.config.options.exclude.length > 0) && <Typography variant="body2" color="text.secondary">Include: {job.config.options.include.join(', ') || 'All files'}. Exclude: {job.config.options.exclude.join(', ') || 'None'}.</Typography>}
        <Typography variant="body2" sx={{ mt: 1 }}>Next run: {active ? 'After this run completes, if enabled' : job.next_run ? date(job.next_run) : 'Not scheduled'}</Typography>
        {job.last_run ? <Typography variant="body2" role="status" color={['Failed', 'Interrupted', 'Cancelled', 'Missed'].includes(job.last_run.status) ? 'error.main' : 'text.primary'} sx={{ mt: 0.5 }}>{job.last_run.status} · {date(job.last_run.finished_at ?? job.last_run.started_at)}. {job.last_run.message}</Typography> : <Typography variant="body2" color="text.secondary">Not run yet.</Typography>}
      </Box>;
    })}
    <Divider />
    {cancelling && <BaseDialog open title="Cancel this job run?" onClose={() => { if (!busy) setCancelling(null); }} actions={<><Button size="small" sx={buttonSx} disabled={busy} onClick={() => setCancelling(null)}>Keep running</Button><Button size="small" color="error" sx={{ borderRadius: '999px' }} disabled={busy} onClick={() => void act(() => jobsApi.cancel(cancelling.id))}>Cancel run</Button></>}>
      <Typography>Cancel pending and active transfers for this run and pause its schedule? Completed uploads will remain. A local scan already in progress may take a few minutes to stop.</Typography>
      {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
    </BaseDialog>}
    {deleting && <BaseDialog open title="Delete saved job?" onClose={() => { if (!busy) setDeleting(null); }} actions={<><Button size="small" sx={buttonSx} disabled={busy} onClick={() => setDeleting(null)}>Keep job</Button><Button size="small" color="error" sx={{ borderRadius: '999px' }} disabled={busy} onClick={() => void act(() => jobsApi.delete(deleting.id))}>Delete job</Button></>}>
      <Typography sx={{ overflowWrap: 'anywhere' }}>Delete {deleting.config.name} and its schedule? This will not delete local files, S3 objects, or transfer history.</Typography>
      {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
    </BaseDialog>}
  </Box>;
}
