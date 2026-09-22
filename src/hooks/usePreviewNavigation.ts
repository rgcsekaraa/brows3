import { useEffect, useMemo, useRef, useState } from 'react';
import type { ListObjectsResult, S3Object } from '@/lib/tauri';
import { canObjectBePreviewed, getObjectName } from '@/lib/objectCapabilities';
import { compareSortable, SortDirection, SortField } from '@/lib/objectSort';

export function previewObjects(objects: S3Object[], field: SortField, direction: SortDirection) {
  const sortable = (o: S3Object) => ({ name: getObjectName(o.key), size: o.size, modifiedTimestamp: o.last_modified ? new Date(o.last_modified).getTime() : 0, storageClass: o.storage_class || 'STANDARD' });
  return Array.from(new Map(objects.filter(o => !o.key.endsWith('/') && canObjectBePreviewed(getObjectName(o.key))).map(o => [o.key, o])).values())
    .sort((a, b) => compareSortable(sortable(a), sortable(b), field, direction));
}

export function usePreviewNavigation({ objects, field, direction, context, objectKey, open, hasMore, query, loadMore, onNavigate }: {
  objects: S3Object[]; field: SortField; direction: SortDirection; context: string; objectKey: string | null; open: boolean;
  hasMore: boolean; query: string; loadMore: () => Promise<ListObjectsResult | null>; onNavigate: (object: S3Object) => void;
}) {
  const sequence = useMemo(() => previewObjects(objects, field, direction), [objects, field, direction]);
  const index = sequence.findIndex(o => o.key === objectKey);
  const latest = useRef({ context, objectKey, open });
  if (latest.current.context !== context || latest.current.objectKey !== objectKey || latest.current.open !== open) latest.current = { context, objectKey, open };
  const lock = useRef<object | null>(null);
  const [busy, setBusy] = useState<object | null>(null);
  const [error, setError] = useState<{ identity: object; message: string } | null>(null);
  useEffect(() => {
    latest.current = { ...latest.current, open };
    return () => { latest.current = { ...latest.current, open: false }; };
  }, [open]);
  async function navigate(step: 'prev' | 'next') {
    if (lock.current === latest.current || !open || index < 0) return;
    const identity = latest.current;
    lock.current = identity; setBusy(identity); setError(null);
    const current = () => latest.current === identity && latest.current.open;
    const report = (message: string) => setError({ identity, message });
    try {
      let list = sequence;
      let position = index;
      if (step === 'next' && position === list.length - 1 && hasMore) {
        let accumulated = objects;
        let more = true;
        const cursors = new Set<string>();
        // Bound API work even when pages contain only folders or unsupported files.
        for (let pageNumber = 0; more && pageNumber < 20; pageNumber++) {
          const page = await loadMore();
          if (!current()) return;
          if (!page) { report('Could not load more files. Retry Next or refresh the folder.'); return; }
          accumulated = [...accumulated, ...page.objects.filter(o => !query || o.key.toLowerCase().includes(query.toLowerCase()))];
          list = previewObjects(accumulated, field, direction);
          position = list.findIndex(o => o.key === objectKey);
          if (position < 0) return;
          more = !!page.next_continuation_token;
          if (position < list.length - 1) break;
          if (page.next_continuation_token) {
            if (cursors.has(page.next_continuation_token)) { report('Listing repeated its cursor. Refresh the folder.'); return; }
            cursors.add(page.next_continuation_token);
          }
        }
        if (position === list.length - 1 && more) { report('No previewable file in the next 20 pages. Choose Next to continue searching.'); return; }
      }
      const target = list[position + (step === 'prev' ? -1 : 1)];
      if (current() && target) onNavigate(target);
    } catch (e) { if (current()) report(String(e)); }
    finally { if (lock.current === identity) { lock.current = null; if (current()) setBusy(null); } }
  }
  return { index, total: sequence.length, previous: index > 0, next: index >= 0 && (index < sequence.length - 1 || hasMore), busy: busy === latest.current, error: error?.identity === latest.current ? error.message : '', navigate };
}
