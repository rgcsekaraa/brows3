'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, IconButton, Pagination, TextField, Typography } from '@mui/material';
import { Close, ExpandLess, ExpandMore } from '@mui/icons-material';
import { BaseDialog } from '@/components/common/BaseDialog';
import { urlActionStyles } from '@/components/common/urlActionStyles';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DEFAULT_URL_LIMIT, MAX_MANIFEST_BYTES, MAX_URL_IMPORTS, parseUrlImports, UrlImportEntry, validateImport } from '@/lib/urlImport';
import { urlApi } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';
import { useProfileStore } from '@/store/profileStore';
import { toast } from '@/store/toastStore';

interface Props { bucket: string; region?: string; prefix: string; profileId: string; onClose: () => void; initialPath?: string; initialLimits?: { max_bytes: number; max_attempts?: number; sha256: string | null } }
interface Row { id: number; entry: UrlImportEntry; headerText: string; expanded: boolean }
const pill = urlActionStyles;
export default function UrlImportDialog({ bucket, region, prefix, profileId, onClose, initialPath, initialLimits }: Props) {
  const activeProfile = useProfileStore(s => s.activeProfileId);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false), alive = useRef(true), nextId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: number, patch: Partial<UrlImportEntry>) => setRows(current => current.map(r => r.id === id ? { ...r, entry: { ...r.entry, ...patch } } : r));
  const materialize = (row: Row): UrlImportEntry => ({ ...row.entry, headers: JSON.parse(row.headerText || '{}') });
  const errors = rows.map(row => {
    try { const entry = materialize(row); return validateImport(entry) || (new TextEncoder().encode(prefix + entry.path).length > 1024 ? 'Full destination key exceeds 1,024 bytes.' : rows.some(other => other.id !== row.id && other.entry.path === entry.path) ? 'Duplicate destination path. Rename or remove this entry.' : ''); }
    catch { return 'Headers must be a valid JSON object.'; }
  });
  const add = (source: string, format: 'text' | 'csv' | 'json') => {
    const parsed = parseUrlImports(source, format);
    if (rows.length + parsed.length > MAX_URL_IMPORTS) throw new Error(`At most ${MAX_URL_IMPORTS} files per batch.`);
    if (initialPath && (parsed.length !== 1 || rows.length)) throw new Error('Add one replacement source URL for this file.');
    setRows(current => [...current, ...parsed.map(entry => ({ id: nextId.current++, entry: { ...entry, ...(initialLimits ? { max_bytes: initialLimits.max_bytes, sha256: initialLimits.sha256, max_attempts: initialLimits.max_attempts || 3 } : {}), path: initialPath ?? entry.path }, headerText: JSON.stringify(entry.headers, null, 2), expanded: false }))]);
    setText(''); setError('');
  };
  const close = () => { if (pending.current || reading) return; if (rows.length || text.trim()) setDiscard(true); else onClose(); };
  async function submit() {
    if (pending.current || reading || !rows.length || errors.some(Boolean) || activeProfile !== profileId) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const count = await urlApi.importUrls(bucket, region, prefix, rows.map(materialize), profileId);
      void useTransferStore.getState().refreshJobs(); useTransferStore.getState().showPanel();
      toast.success(`${count} URL imports queued`, 'Follow progress in Uploads.');
      if (alive.current) onClose();
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <><BaseDialog open title={initialPath ? 'Replace import source' : 'Import from URLs'} maxWidth="md" onClose={close} closeDisabled={busy || reading} actions={<>
    <Button size="small" sx={pill} disabled={busy || reading} onClick={close}>Cancel</Button>
    <Button size="small" sx={pill} variant="contained" onClick={submit} disabled={busy || reading || !!text.trim() || !rows.length || errors.some(Boolean) || activeProfile !== profileId}>{busy ? 'Queueing...' : 'Import files'}</Button>
  </>}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Destination: s3://{bucket}/{prefix}{initialPath || ''}</Typography>
      <Typography variant="body2" color="text.secondary">Files pass through this computer using temporary disk space. URLs and headers are kept only for this session. Public internet sources only.</Typography>
      <TextField label="Source URLs" multiline minRows={3} maxRows={6} fullWidth value={text} onChange={e => setText(e.target.value)} disabled={busy || reading} helperText="One URL per line. Add links to review before importing. No S3 permissions are changed." />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" sx={pill} variant="outlined" disabled={busy || reading || !text.trim()} onClick={() => { try { add(text, 'text'); } catch (e) { setError(String(e)); } }}>Add links</Button>
        <Button size="small" sx={pill} disabled={busy || reading} onClick={() => input.current?.click()}>Import CSV / JSON</Button>
        <input ref={input} type="file" accept=".csv,.json" aria-label="Import URL file" style={{ display: 'none' }} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          setReading(true);
          try { if (file.size > MAX_MANIFEST_BYTES) throw new Error('Import file exceeds 2 MiB.'); if (!/\.(csv|json)$/i.test(file.name)) throw new Error('Choose a CSV or JSON file.'); const content = await file.text(); if (alive.current) add(content, file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'); }
          catch (e) { if (alive.current) setError(String(e)); }
          finally { if (alive.current) setReading(false); }
        }} />
        {reading && <CircularProgress size={16} />}
      </Box>
      <Typography variant="caption" color="text.secondary">CSV requires a url column. JSON accepts an array of URLs or objects. Optional fields: path, replace, headers, sha256, max_bytes, max_attempts. Up to {MAX_URL_IMPORTS} files / 2 MiB.</Typography>
      {rows.length > 0 && <>
        <Typography variant="body2" fontWeight={600}>{rows.length} files to review</Typography>
        {rows.slice((page - 1) * 10, page * 10).map(row => {
          const rowError = errors[rows.indexOf(row)];
          let host = 'Invalid URL'; try { host = new URL(row.entry.url).host; } catch { /* validated below */ }
          return <Box key={row.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5, minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField fullWidth size="small" label="Destination filename / path" value={row.entry.path} disabled={busy || !!initialPath} onChange={e => update(row.id, { path: e.target.value })} />
              <IconButton size="small" aria-label={`Configure ${row.entry.path || 'file'}`} aria-expanded={row.expanded} disabled={busy} onClick={() => setRows(current => current.map(r => r.id === row.id ? { ...r, expanded: !r.expanded } : r))}>{row.expanded ? <ExpandLess /> : <ExpandMore />}</IconButton>
              <IconButton size="small" aria-label={`Remove ${row.entry.path || 'file'} from import`} disabled={busy} onClick={() => { setRows(current => current.filter(r => r.id !== row.id)); setPage(1); }}><Close fontSize="small" /></IconButton>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .5, overflowWrap: 'anywhere' }}>{host} · {row.entry.replace ? 'Replace only if destination is unchanged' : 'Do not replace existing files'}</Typography>
            {row.expanded && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1.5 }}>
              <TextField size="small" label="Source URL" type="password" autoComplete="off" fullWidth value={row.entry.url} disabled={busy} onChange={e => update(row.id, { url: e.target.value })} helperText="Hidden to protect signed URL tokens. Paste a fresh URL here if it expires." />
              <FormControlLabel control={<Checkbox size="small" disabled={busy} checked={row.entry.replace} onChange={(_, checked) => update(row.id, { replace: checked })} />} label="Allow replacement of this destination file" />
              <TextField size="small" label="Maximum download size (GiB)" type="number" value={Number.isFinite(row.entry.max_bytes) ? row.entry.max_bytes / 1024 ** 3 : ''} disabled={busy} onChange={e => update(row.id, { max_bytes: Math.round(Number(e.target.value) * 1024 ** 3) })} helperText={`Default ${DEFAULT_URL_LIMIT / 1024 ** 3} GiB. Adjust for large files. Requires available temporary disk space.`} />
              <TextField size="small" label="Expected SHA-256 (optional)" value={row.entry.sha256 || ''} disabled={busy} onChange={e => update(row.id, { sha256: e.target.value || null })} />
              <TextField size="small" label="Download attempts" type="number" value={row.entry.max_attempts} disabled={busy} onChange={e => update(row.id, { max_attempts: Number(e.target.value) })} helperText="1 to 5 attempts, including the first. Only temporary download failures retry automatically." />
              <TextField size="small" label="Source headers (JSON, optional)" multiline minRows={2} value={row.headerText} disabled={busy} autoComplete="off" onChange={e => setRows(current => current.map(r => r.id === row.id ? { ...r, headerText: e.target.value } : r))} helperText='Example: {"Authorization":"Bearer token"}. Headers are not forwarded to another origin on redirects.' />
            </Box>}
            {rowError && <Alert severity="error" sx={{ mt: 1 }}>{rowError}</Alert>}
          </Box>;
        })}
        {rows.length > 10 && <Pagination size="small" count={Math.ceil(rows.length / 10)} page={page} onChange={(_, value) => setPage(value)} />}
      </>}
      {rows.some(r => r.entry.replace) && <Alert severity="warning">You have allowed replacement for some files. Those files will be replaced only if their destination ETag still matches the queue-time check.</Alert>}
      {busy && <Typography role="status" variant="body2">Checking replacement destinations and queueing imports...</Typography>}
      {activeProfile !== profileId && <Alert severity="warning">Switch back to this transfer&apos;s connection before importing.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  </BaseDialog><ConfirmDialog open={discard} title="Discard import draft?" message="These URLs have not been queued. Discard the draft or keep reviewing." confirmLabel="Discard draft" cancelLabel="Keep reviewing" onClose={() => setDiscard(false)} onConfirm={onClose} /></>;
}
