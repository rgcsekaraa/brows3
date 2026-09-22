import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { previewObjects, usePreviewNavigation } from '@/hooks/usePreviewNavigation';
import type { ListObjectsResult, S3Object } from '@/lib/tauri';
const object = (key: string, size = 1): S3Object => ({ key, size, last_modified: null, storage_class: null });
const page = (objects: S3Object[], next: string | null = null): ListObjectsResult => ({ objects, common_prefixes: [], next_continuation_token: next, is_truncated: !!next, prefix: '' });
const options = () => ({ objects: [object('a.svg')], field: 'name' as const, direction: 'asc' as const, context: 'profile-a', objectKey: 'a.svg', open: true, hasMore: true, query: '', loadMore: vi.fn<() => Promise<ListObjectsResult | null>>(), onNavigate: vi.fn() });

test('preview ordering skips folders and binary files, deduplicates keys, and follows table sorts', () => {
  const objects = [object('z.svg', 2), object('folder/'), object('b.zip'), object('a.txt', 3), object('z.svg', 2)];
  expect(previewObjects(objects, 'name', 'asc').map(o => o.key)).toEqual(['a.txt', 'z.svg']);
  expect(previewObjects(objects, 'size', 'asc').map(o => o.key)).toEqual(['z.svg', 'a.txt']);
  expect(previewObjects(objects, 'name', 'desc').map(o => o.key)).toEqual(['z.svg', 'a.txt']);
});
test('navigation passes empty pages and serializes repeated requests', async () => {
  const opts = options(); const pending = Promise.withResolvers<ListObjectsResult>();
  opts.loadMore.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([object('b.txt')]));
  const view = renderHook(() => usePreviewNavigation(opts)); let work: Promise<void>;
  act(() => { work = view.result.current.navigate('next'); });
  await act(async () => { await view.result.current.navigate('next'); });
  expect(opts.loadMore).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(page([], 'page2')); await work; });
  expect(opts.loadMore).toHaveBeenCalledTimes(2); expect(opts.onNavigate).toHaveBeenCalledWith(object('b.txt'));
});
test.each(['context', 'close', 'reopen', 'unmount'])('late navigation cannot escape %s changes', async kind => {
  const opts = options(); const pending = Promise.withResolvers<ListObjectsResult>(); opts.loadMore.mockReturnValueOnce(pending.promise);
  const view = renderHook(props => usePreviewNavigation(props), { initialProps: opts }); let work: Promise<void>;
  act(() => { work = view.result.current.navigate('next'); });
  if (kind === 'context') view.rerender({ ...opts, context: 'profile-b' });
  else if (kind === 'unmount') view.unmount();
  else { view.rerender({ ...opts, open: false }); if (kind === 'reopen') view.rerender(opts); }
  await act(async () => { pending.resolve(page([object('b.txt')])); await work; });
  expect(opts.onNavigate).not.toHaveBeenCalled();
});
test('pagination errors preserve the current file and permit retry', async () => {
  const opts = options(); opts.loadMore.mockResolvedValueOnce(null).mockResolvedValueOnce(page([object('b.txt')]));
  const view = renderHook(() => usePreviewNavigation(opts));
  await act(async () => view.result.current.navigate('next'));
  expect(view.result.current.error).toContain('Retry'); expect(opts.onNavigate).not.toHaveBeenCalled();
  await act(async () => view.result.current.navigate('next')); expect(opts.onNavigate).toHaveBeenCalledTimes(1);
});
test('pagination is bounded and local search excludes nonmatching new files', async () => {
  const opts = options(); opts.query = 'a'; let counter = 0;
  opts.loadMore.mockImplementation(async () => page([object('b.txt')], `page${++counter}`));
  const view = renderHook(() => usePreviewNavigation(opts));
  await act(async () => view.result.current.navigate('next'));
  expect(opts.loadMore).toHaveBeenCalledTimes(20); expect(opts.onNavigate).not.toHaveBeenCalled();
  expect(view.result.current.error).toContain('20 pages');
});
test('navigation never wraps at either end', async () => {
  const opts = options(); opts.hasMore = false;
  const view = renderHook(() => usePreviewNavigation(opts));
  await act(async () => { await view.result.current.navigate('prev'); await view.result.current.navigate('next'); });
  expect(opts.onNavigate).not.toHaveBeenCalled(); expect(opts.loadMore).not.toHaveBeenCalled();
});

test('a cycling listing cursor stops pagination without moving the preview', async () => {
  const opts = options();
  opts.loadMore.mockResolvedValueOnce(page([], 'one'))
    .mockResolvedValueOnce(page([], 'two'))
    .mockResolvedValueOnce(page([], 'one'));
  const view = renderHook(() => usePreviewNavigation(opts));
  await act(async () => view.result.current.navigate('next'));
  expect(opts.loadMore).toHaveBeenCalledTimes(3);
  expect(opts.onNavigate).not.toHaveBeenCalled();
  expect(view.result.current.error).toContain('Refresh the folder');
  expect(view.result.current.busy).toBe(false);
});
