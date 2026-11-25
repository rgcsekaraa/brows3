'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { reservedBucket, validPrivateLabel, validTransferPassphrase } from '@/lib/encryptedTransfer';
import { bucketApi } from '@/lib/tauri';
import { toast } from '@/store/toastStore';

export interface BucketAction {
  mode: 'create' | 'delete' | 'policy';
  profileId: string;
  region: string;
  bucket?: string;
}

export default function BucketManagementDialog({ action, onClose }: { action: BucketAction; onClose: () => void }) {
  const [name, setName] = useState(action.bucket || '');
  const [region, setRegion] = useState(action.region);
  const [protection, setProtection] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [repeated, setRepeated] = useState('');
  const encrypted = protection === 'encrypted';
  const canCreate = name.trim() && region.trim() && (encrypted ? validPrivateLabel(name) && validTransferPassphrase(passphrase) && passphrase === repeated : protection === 'plain' && !reservedBucket(name.trim()));
  const [confirmation, setConfirmation] = useState('');
  const [policy, setPolicy] = useState('');
  const [originalPolicy, setOriginalPolicy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(action.mode !== 'policy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (action.mode === 'policy' && action.bucket) {
      bucketApi.getBucketPolicy(action.bucket, action.region, action.profileId).then(value => {
        if (cancelled) return;
        setOriginalPolicy(value);
        setPolicy(value || '');
        setLoaded(true);
      }).catch(error => {
        if (!cancelled) setError(String(error));
      });
    }
    return () => { cancelled = true; mounted.current = false; };
  }, [action]);

  const submit = async () => {
    if (submitting.current || !loaded) return;
    if (action.mode === 'create' && !canCreate) return;
    if (action.mode !== 'create' && confirmation !== action.bucket) return;
    if (action.mode === 'policy' && policy.trim()) {
      try {
        const value = JSON.parse(policy);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      } catch {
        setError('Enter a valid JSON policy object.');
        return;
      }
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      if (action.mode === 'create') {
        if (encrypted) {
          setPassphrase(''); setRepeated('');
          const physical = await bucketApi.createEncryptedBucket(name.trim(), region.trim(), action.profileId, passphrase);
          toast.success(`Created encrypted bucket ${physical}`);
        } else {
          await bucketApi.createBucket(name.trim(), region.trim(), action.profileId);
          toast.success(`Created bucket ${name.trim()}`);
        }
      } else if (action.mode === 'delete') {
        await bucketApi.deleteBucket(action.bucket!, action.region, confirmation, action.profileId);
        toast.success(`Deleted bucket ${action.bucket}`);
      } else {
        await bucketApi.putBucketPolicy(action.bucket!, action.region, policy.trim() ? policy : null, originalPolicy, action.profileId);
        toast.success(policy.trim() ? 'Bucket policy saved' : 'Bucket policy removed');
      }
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) setError(encrypted ? 'Encrypted bucket creation did not complete. Refresh the bucket list before retrying.' : error instanceof Error ? error.message : String(error));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const title = action.mode === 'create' ? 'Create bucket' : action.mode === 'delete' ? 'Delete bucket' : 'Bucket policy';
  const label = action.mode === 'create' ? 'Create' : action.mode === 'delete' ? 'Delete' : policy.trim() ? 'Save policy' : 'Remove policy';
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth={action.mode === 'policy' ? 'md' : 'sm'} aria-labelledby="bucket-action-title">
      <DialogTitle id="bucket-action-title">{title}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {action.mode === 'create' ? <>
          <Typography id="bucket-encryption-choice">Would you like this entire bucket to be end-to-end encrypted?</Typography>
          <RadioGroup aria-labelledby="bucket-encryption-choice" value={protection} onChange={event => { if (encrypted) setName(''); setProtection(event.target.value); setPassphrase(''); setRepeated(''); }}>
            <FormControlLabel value="encrypted" control={<Radio />} disabled={busy} label="Yes, create an encrypted bucket" />
            <FormControlLabel value="plain" control={<Radio />} disabled={busy} label="No, use ordinary transfers" />
          </RadioGroup>
          <TextField fullWidth margin="dense" autoComplete="off" label={encrypted ? 'Private display name' : 'Bucket name'} value={name} disabled={busy} onChange={event => setName(event.target.value)} helperText={encrypted ? '1–128 UTF-8 bytes. Shown only after unlock.' : 'Use 3 to 63 lowercase letters, numbers, dots or hyphens.'} />
          {encrypted && <>
            <Typography>The permanent S3 address is b3e1- followed by 32 random hex digits, not your private display name. The full address is shown after creation. This choice cannot be changed. File contents are encrypted; object names and sizes remain visible. Other clients can still write unencrypted data.</Typography>
            <TextField fullWidth margin="dense" type="password" autoComplete="new-password" disabled={busy} label="Passphrase" helperText="12–1024 UTF-8 bytes. Keep it safe: there is no recovery." value={passphrase} onChange={event => setPassphrase(event.target.value)} />
            <TextField fullWidth margin="dense" type="password" autoComplete="new-password" disabled={busy} label="Confirm passphrase" value={repeated} onChange={event => setRepeated(event.target.value)} error={!!repeated && repeated !== passphrase} helperText={repeated && repeated !== passphrase ? 'Passphrases do not match.' : undefined} />
          </>}
          <TextField fullWidth margin="dense" label="Region" value={region} disabled={busy} onChange={event => setRegion(event.target.value)} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>The bucket is created with your provider&apos;s default access settings. Some providers require bucket creation through their own console.</Typography>
        </> : <>
          <Typography sx={{ mb: 2, overflowWrap: 'anywhere' }}>{action.bucket}</Typography>
          {action.mode === 'delete' ? <Alert severity="warning" sx={{ mb: 2 }}>Only empty buckets can be deleted. Remove all objects, versions and delete markers first. Deletion cannot be undone.</Alert> : <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Changing a policy changes access to this bucket. Clear the policy field to remove the current policy. Avoid editing it elsewhere while saving; your provider cannot atomically reject simultaneous policy changes.</Typography>
            <TextField fullWidth multiline minRows={10} maxRows={20} label="Policy JSON" value={policy} disabled={!loaded || busy} onChange={event => setPolicy(event.target.value)} sx={{ mb: 2 }} />
            {!loaded && !error && <Typography role="status">Loading policy...</Typography>}
          </>}
          <TextField fullWidth margin="dense" label="Type the bucket name to confirm" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
        </>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={action.mode === 'delete' ? 'error' : 'primary'} onClick={submit} disabled={busy || !loaded || (action.mode === 'create' ? !canCreate : confirmation !== action.bucket)}>{busy ? 'Working...' : label}</Button>
      </DialogActions>
    </Dialog>
  );
}
