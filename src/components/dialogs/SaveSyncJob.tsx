'use client';

import { useRef, useState, useEffect } from 'react';
import { Alert, Box, Button, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';
import { jobsApi, SavedJobConfig } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

export default function SaveSyncJob({ config, onBusy, blocked }: {
  config: Omit<SavedJobConfig, 'name' | 'interval_minutes' | 'allow_replacement'>;
  onBusy: (busy: boolean) => void;
  blocked: boolean;
}) {
  const [name, setName] = useState('');
  const [interval, setInterval] = useState(0);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save() {
    if (busy || blocked || !approved) return;
    setBusy(true); onBusy(true); setError('');
    try {
      await jobsApi.save({ ...config, name: name.trim(), interval_minutes: interval || null, allow_replacement: !config.options.skip_existing }, approved);
      toast.success('Job saved. Manage it in Jobs.');
      if (alive.current) setSaved(true);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) { setBusy(false); onBusy(false); } }
  }
  if (saved) return <Alert severity="success" sx={{ mb: 2 }}>Job saved. Open Jobs to run it, pause its schedule, or view its result.</Alert>;
  return <Box component="fieldset" disabled={busy || blocked} sx={{ border: 0, borderTop: '1px solid', borderColor: 'divider', pt: 2, px: 0, mx: 0, mb: 2, minWidth: 0 }}>
    <Typography component="h3" variant="subtitle2" sx={{ mb: 1 }}>Save this sync as a job</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2, mb: 1 }}>
      <TextField size="small" label="Job name" value={name} disabled={busy} inputProps={{ maxLength: 120 }} onChange={e => { setName(e.target.value); setApproved(false); }} />
      <TextField select size="small" label="Schedule" value={interval} disabled={busy} onChange={e => { setInterval(Number(e.target.value)); setApproved(false); }}>
        <MenuItem value={0}>Manual only</MenuItem><MenuItem value={15}>Every 15 minutes</MenuItem><MenuItem value={60}>Every hour</MenuItem><MenuItem value={1440}>Every day</MenuItem><MenuItem value={10080}>Every week</MenuItem>
      </TextField>
    </Box>
    <Typography variant="body2" color="text.secondary">Runs only while Brows3 is open. The first scheduled run starts after the selected interval; later intervals start when a run finishes. Missed runs while closed are paused, not replayed. Failures pause the schedule.</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Each run compares fresh content with these filters. Bandwidth per transfer: {config.bandwidth ? `${config.bandwidth / 1024} KiB/s` : 'Unlimited'}. To change a saved configuration, delete it and save a new job.</Typography>
    <FormControlLabel disabled={busy} sx={{ ml: 0, gap: 1, my: 1, alignItems: 'flex-start' }} control={<StyledCheckbox aria-label="Approve saved job" checked={approved} onChange={e => { if (!busy) setApproved(e.target.checked); }} />} label={config.options.skip_existing
      ? 'I approve future uploads from this folder to this destination. Existing objects will be skipped. S3 charges may apply.'
      : 'I approve future uploads and replacement of changed or unverified objects, without another prompt. Previous contents may be unrecoverable without bucket versioning. S3 charges may apply.'} />
    {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
    <Button size="small" variant="outlined" sx={{ borderRadius: '999px', color: 'text.primary' }} disabled={!name.trim() || !approved || busy || blocked} onClick={save}>{busy ? 'Saving job...' : 'Save job'}</Button>
  </Box>;
}
