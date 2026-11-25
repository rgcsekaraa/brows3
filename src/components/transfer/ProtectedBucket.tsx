'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { open, save } from '@tauri-apps/plugin-dialog';
import { VirtualizedObjectTable } from '@/components/common/VirtualizedObjectTable';
import { useObjects } from '@/hooks/useObjects';
import { bucketApi, transferApi } from '@/lib/tauri';
import { encryptedObjectKey, isUserObject, lockedBucketTitle, validPrivateLabel, validTransferPassphrase, watchSessionExpiry, type EncryptedTarget } from '@/lib/encryptedTransfer';
import { toast } from '@/store/toastStore';

type Scope = { bucketName: string; bucketRegion: string; expectedProfileId: string };

function ProtectedFiles({ scope, sessionToken, expiresAtMs, onInvalidate, initialPrefix }: { scope: Scope; sessionToken: string; expiresAtMs: number; onInvalidate: () => void; initialPrefix: string }) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const { data, error, isLoading, hasMore, loadMore, isLoadingMore, refresh } = useObjects(scope.bucketName, scope.bucketRegion, prefix, 'name', 'asc', sessionToken);
  const folders = useMemo(() => data?.common_prefixes.filter(isUserObject) ?? [], [data]);
  const objects = useMemo(() => data?.objects.filter(object => isUserObject(object.key) && !object.key.endsWith('/')) ?? [], [data]);
  const [activity, setActivity] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (error) { toast.error('Protected listing failed. Unlock the bucket again.'); onInvalidate(); }
  }, [error, onInvalidate]);
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible' && Date.now() < expiresAtMs) void refresh(); };
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    return () => { window.removeEventListener('focus', check); window.removeEventListener('pageshow', check); };
  }, [expiresAtMs, refresh]);

  async function transfer(target: EncryptedTarget) {
    if (active.current) return;
    if (Date.now() >= expiresAtMs) { onInvalidate(); return; }
    active.current = true;
    const uploading = target.mode === 'upload';
    setActivity('Choosing a file…');
    try {
      const localPath = uploading ? await open({ multiple: false, directory: false, title: 'Choose a file to encrypt' }) : await save({ title: 'Save decrypted contents to a new file' });
      if (!mounted.current || typeof localPath !== 'string') return;
      if (Date.now() >= expiresAtMs) { onInvalidate(); return; }
      const key = encryptedObjectKey(target, localPath);
      if (!key) throw new Error();
      setActivity(uploading ? 'Encrypting and uploading…' : 'Downloading and authenticating…');
      await transferApi.encryptedFile(target.mode, { ...scope, localPath, key, sessionToken });
      toast.success(uploading ? 'Encrypted file uploaded.' : 'File authenticated, decrypted and saved.');
    } catch {
      if (mounted.current) onInvalidate();
      toast.error(uploading ? 'Encrypted upload failed. Check the file size, connection and that the object does not already exist.' : 'Authenticated download failed. Check that the object is encrypted and the destination is a new file.');
    } finally {
      active.current = false;
      if (mounted.current) setActivity('');
    }
  }

  return <Stack spacing={2}>
    <Typography>Files uploaded here are encrypted. Names and sizes are visible. Files written by other clients are not verified until downloaded. Existing objects and destination files are never replaced.</Typography>
    <Typography sx={{ overflowWrap: 'anywhere' }}>Location: /{prefix}</Typography>
    <Stack direction="row" spacing={1}>
      <Button variant="contained" disabled={!!activity} onClick={() => transfer({ mode: 'upload', prefix })}>Upload</Button>
      {prefix && <Button disabled={!!activity} onClick={() => setPrefix(prefix.replace(/[^/]+\/?$/, ''))}>Up one folder</Button>}
      <Button onClick={() => refresh()} disabled={isLoading}>Refresh</Button>
    </Stack>
    <Typography variant="caption">Single files up to 1 GiB. Folder transfers, editing and sharing are unavailable in encrypted buckets.</Typography>
    {(activity || isLoading) && <Typography role="status">{activity || 'Loading files…'}</Typography>}
    {error && <Alert severity="error">Could not list this folder.</Alert>}
    {!isLoading && data && (folders.length + objects.length > 100 ? (
      <Box sx={{ display: 'flex', height: 'min(60vh, 640px)', minHeight: 200 }}>
        <VirtualizedObjectTable
          folders={folders} objects={objects} sortField="name" sortDirection="asc"
          isLoading={false} actionsDisabled={!!activity} onNavigate={setPrefix}
          onDownload={key => transfer({ mode: 'download', key })}
        />
      </Box>
    ) : <List>
      {folders.map(folder => <ListItem key={folder}><Button disabled={!!activity} onClick={() => setPrefix(folder)}>{folder.slice(prefix.length)}</Button></ListItem>)}
      {objects.map(object => <ListItem key={object.key}>
        <ListItemText primary={object.key.slice(prefix.length)} sx={{ overflowWrap: 'anywhere' }} />
        <Button disabled={!!activity} aria-label={`Download ${object.key}`} onClick={() => transfer({ mode: 'download', key: object.key })}>Download</Button>
      </ListItem>)}
    </List>)}
    {hasMore && <Button disabled={isLoadingMore} onClick={() => loadMore()}>Load more</Button>}
  </Stack>;
}

export default function ProtectedBucket({ scope, prefix }: { scope: Scope; prefix: string }) {
  const [passphrase, setPassphrase] = useState('');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState(0);
  const [retryLock, setRetryLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const session = useRef('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (session.current) void bucketApi.lockEncryptedBucket(session.current).catch(() => toast.error('Could not confirm that the encrypted session was locked.'));
    };
  }, []);

  const lock = useCallback(async () => {
    if (!session.current || pending.current) return;
    pending.current = true;
    setToken(''); setLabel(''); setExpiresAtMs(0); setPassphrase(''); setError(''); setBusy(true);
    try {
      await bucketApi.lockEncryptedBucket(session.current);
      session.current = '';
      if (mounted.current) setRetryLock(false);
    } catch {
      if (mounted.current) { setRetryLock(true); setError('Could not confirm lock. Retry before unlocking again.'); }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (token) return watchSessionExpiry(expiresAtMs, () => { void lock(); });
  }, [token, expiresAtMs, lock]);

  async function changeLock() {
    if (pending.current) return;
    if (session.current) { await lock(); return; }
    pending.current = true;
    setBusy(true); setError(''); setPassphrase('');
    try {
      const next = await bucketApi.unlockEncryptedBucket(scope.bucketName, scope.bucketRegion, scope.expectedProfileId, passphrase);
      if (!next?.sessionToken) throw new Error();
      if (!mounted.current || !Number.isSafeInteger(next.expiresAtMs) || next.expiresAtMs <= Date.now() || typeof next.label !== 'string' || !validPrivateLabel(next.label)) {
        await bucketApi.lockEncryptedBucket(next.sessionToken);
        throw new Error();
      }
      session.current = next.sessionToken; setToken(next.sessionToken); setLabel(next.label); setExpiresAtMs(next.expiresAtMs);
    } catch {
      if (mounted.current) setError('Cannot unlock this bucket. Check its descriptor, connection and passphrase.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <Box sx={{ p: 3 }}><Stack spacing={2}>
    <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>{label || lockedBucketTitle(scope.bucketName)}</Typography>
    <Typography variant="subtitle1">End-to-end encryption · {token ? 'Unlocked' : 'Locked'}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!token && !retryLock && <TextField type="password" autoComplete="off" label="Bucket passphrase" value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)} />}
    <Button disabled={busy || (!token && !retryLock && !validTransferPassphrase(passphrase))} onClick={changeLock}>{busy ? 'Working…' : token || retryLock ? 'Lock bucket' : 'Unlock bucket'}</Button>
    {token && <ProtectedFiles scope={scope} sessionToken={token} expiresAtMs={expiresAtMs} onInvalidate={lock} initialPrefix={prefix} />}
  </Stack></Box>;
}
