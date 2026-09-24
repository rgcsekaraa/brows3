'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Pagination, TextField, Typography } from '@mui/material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { urlActionStyles } from '@/components/common/urlActionStyles';
import { copyToClipboard, urlApi } from '@/lib/tauri';
import { validateHttpUrl } from '@/lib/urlImport';

export default function PublicUrlsDialog({ bucket, region, keys, profileId, onClose }: { bucket: string; region?: string; keys: string[]; profileId: string; onClose: () => void }) {
  const [urls, setUrls] = useState<string[]>(keys.map(() => ''));
  const [defaults, setDefaults] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [checks, setChecks] = useState<Record<number,string>>({});
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    urlApi.publicUrls(bucket, region, keys, profileId).then(values => { if (alive.current) { setUrls(values); setDefaults(values); } })
      .catch(e => { if (alive.current) setError(String(e)); }).finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; };
  }, [bucket, region, keys, profileId]);
  const invalid = (value: string) => validateHttpUrl(value) || (new URL(value).search ? 'Use a public URL without query parameters. Generate signed links separately.' : '');
  const errors = urls.map(invalid);
  async function copy() {
    if (pending.current || busy || errors.some(Boolean)) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const values = await urlApi.publicUrls(bucket, region, keys, profileId, Object.fromEntries(keys.map((key, i) => [key, urls[i]])));
      if (!alive.current) return;
      await copyToClipboard(values.join('\n'));
      if (alive.current) setCopied(true);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function check(index: number) {
    if (pending.current || busy) return;
    pending.current = true; setBusy(true);
    try {
      const result = await urlApi.checkPublicUrl(bucket, region, keys[index], profileId, urls[index]);
      if (alive.current) setChecks(values => ({ ...values, [index]: result }));
    } catch (e) { if (alive.current) setChecks(values => ({ ...values, [index]: String(e) })); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <BaseDialog open title={keys.length === 1 ? 'Copy public URL' : 'Copy public URLs'} onClose={onClose} maxWidth="md" actions={<>
    <Button size="small" sx={urlActionStyles} onClick={onClose}>Close</Button>
    <Button size="small" sx={urlActionStyles} variant="contained" disabled={busy || errors.some(Boolean)} onClick={copy}>{copied ? 'Copied' : keys.length === 1 ? 'Copy URL' : `Copy ${keys.length} URLs`}</Button>
  </>}>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Connection and bucket settings provide defaults. You can change any URL below for this copy only, including its host and path. Multiple URLs are copied one per line.</Typography>
    <Alert severity="info" sx={{ mb: 2 }}>These links do not grant access. Files must already be public through S3 or your CDN. Access checks send an anonymous HEAD request only when you choose Check access.</Alert>
    {busy && <Box role="status" sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}><CircularProgress size={16} /><Typography variant="body2">Working...</Typography></Box>}
    {keys.slice((page - 1) * 10, page * 10).map((key, offset) => {
      const i = (page - 1) * 10 + offset;
      return <Box key={key} sx={{ mb: 2, minWidth: 0 }}>
        <Typography variant="body2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>{key}</Typography>
        <TextField label={`Public URL ${i + 1}`} fullWidth size="small" value={urls[i] || ''} disabled={busy} error={!!urls[i] && !!errors[i]} helperText={urls[i] ? errors[i] : undefined} onChange={e => { setUrls(values => values.map((v, n) => n === i ? e.target.value : v)); setCopied(false); setChecks(values => ({ ...values, [i]: '' })); }} />
        <Box sx={{ display: 'flex', gap: 1, mt: .5 }}>
          <Button size="small" sx={urlActionStyles} disabled={busy || !!errors[i]} onClick={() => void check(i)}>Check access</Button>
          {defaults[i] && urls[i] !== defaults[i] && <Button size="small" sx={urlActionStyles} disabled={busy} onClick={() => { setUrls(values => values.map((v,n) => n === i ? defaults[i] : v)); setCopied(false); setChecks(values => ({ ...values, [i]: '' })); }}>Reset to connection default</Button>}
        </Box>
        {checks[i] && <Typography role="status" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{checks[i]}</Typography>}
      </Box>;
    })}
    {keys.length > 10 && <Pagination size="small" count={Math.ceil(keys.length / 10)} page={page} onChange={(_, value) => setPage(value)} />}
    {error && <Alert severity="error">{error}</Alert>}
  </BaseDialog>;
}
