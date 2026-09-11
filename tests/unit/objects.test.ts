import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useObjects } from '@/hooks/useObjects';
import { invalidateCache, objectApi, type ListObjectsResult } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { useAppStore } from '@/store/appStore';

vi.mock('@/lib/tauri', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>();
  return { ...actual, objectApi: { ...actual.objectApi, listObjects: vi.fn() } };
});

const listing = (key: string): ListObjectsResult => ({
  objects: [{ key, size: 1, last_modified: null, storage_class: null }],
  common_prefixes: [], next_continuation_token: null, is_truncated: false, prefix: '',
});

beforeEach(() => {
  useProfileStore.getState().setActiveProfileId('a');
  useAppStore.getState().clearDiscoveredRegions();
  vi.mocked(objectApi.listObjects).mockImplementation(async (_bucket, region) => listing(region || 'default'));
});

test('region changes reload the view and still allow refresh', async () => {
  const view = renderHook(({ region }) => useObjects('bucket', region), { initialProps: { region: 'us-east-1' } });
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('us-east-1'));
  view.rerender({ region: 'us-west-2' });
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('us-west-2'));
  await act(async () => view.result.current.refresh());
  expect(view.result.current.data?.objects[0].key).toBe('us-west-2');
  expect(objectApi.listObjects).toHaveBeenCalledTimes(3);
});

test('a response for the old region cannot replace the current view', async () => {
  const old = Promise.withResolvers<ListObjectsResult>();
  vi.mocked(objectApi.listObjects).mockReturnValueOnce(old.promise);
  const view = renderHook(({ region }) => useObjects('bucket', region), { initialProps: { region: 'us-east-1' } });
  view.rerender({ region: 'us-west-2' });
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('us-west-2'));
  await act(async () => old.resolve(listing('old')));
  expect(view.result.current.data?.objects[0].key).toBe('us-west-2');
});

test('cache invalidation refetches the visible folder', async () => {
  const view = renderHook(() => useObjects('bucket', 'us-east-1'));
  await waitFor(() => expect(view.result.current.data).not.toBeNull());
  vi.mocked(objectApi.listObjects).mockResolvedValue(listing('updated'));
  act(() => invalidateCache());
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('updated'));
  expect(objectApi.listObjects).toHaveBeenCalledTimes(2);
});

test('invalidation prevents an outstanding request from restoring stale data', async () => {
  const old = Promise.withResolvers<ListObjectsResult>();
  vi.mocked(objectApi.listObjects).mockReturnValueOnce(old.promise);
  const view = renderHook(() => useObjects('bucket', 'us-east-1'));
  vi.mocked(objectApi.listObjects).mockResolvedValue(listing('updated'));
  act(() => invalidateCache());
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('updated'));
  await act(async () => old.resolve(listing('old')));
  expect(view.result.current.data?.objects[0].key).toBe('updated');
});

test('pagination appends objects, merges folders and stops at the final page', async () => {
  vi.mocked(objectApi.listObjects)
    .mockResolvedValueOnce({ ...listing('first'), common_prefixes: ['folder/'], next_continuation_token: 'cursor', is_truncated: true })
    .mockResolvedValueOnce({ ...listing('second'), common_prefixes: ['folder/', 'other/'] });
  const view = renderHook(() => useObjects('bucket', 'us-east-1'));
  await waitFor(() => expect(view.result.current.hasMore).toBe(true));
  await act(async () => view.result.current.loadMore());
  expect(view.result.current.data?.objects.map(object => object.key)).toEqual(['first', 'second']);
  expect(view.result.current.data?.common_prefixes).toEqual(['folder/', 'other/']);
  expect(view.result.current.hasMore).toBe(false);
  await act(async () => view.result.current.loadMore());
  expect(objectApi.listObjects).toHaveBeenCalledTimes(2);
  expect(vi.mocked(objectApi.listObjects).mock.calls[1][4]).toBe('cursor');
});

test('expired pagination reports an error while keeping the loaded page', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    vi.mocked(objectApi.listObjects)
      .mockResolvedValueOnce({ ...listing('first'), next_continuation_token: 'expired', is_truncated: true })
      .mockRejectedValueOnce(new Error('Listing expired. Refresh the folder.'));
    const view = renderHook(() => useObjects('bucket', 'us-east-1'));
    await waitFor(() => expect(view.result.current.hasMore).toBe(true));
    await act(async () => view.result.current.loadMore());
    expect(view.result.current.error).toBe('Listing expired. Refresh the folder.');
    expect(view.result.current.data?.objects[0].key).toBe('first');
    expect(view.result.current.isLoadingMore).toBe(false);
  } finally {
    log.mockRestore();
  }
});

test('a late next page cannot append objects to another folder', async () => {
  const nextPage = Promise.withResolvers<ListObjectsResult>();
  vi.mocked(objectApi.listObjects)
    .mockResolvedValueOnce({ ...listing('first'), next_continuation_token: 'cursor', is_truncated: true })
    .mockReturnValueOnce(nextPage.promise)
    .mockResolvedValueOnce({ ...listing('new-folder/current'), prefix: 'new-folder/' });
  const view = renderHook(({ prefix }) => useObjects('bucket', 'us-east-1', prefix), { initialProps: { prefix: '' } });
  await waitFor(() => expect(view.result.current.hasMore).toBe(true));
  let loading: Promise<void>;
  act(() => { loading = view.result.current.loadMore(); });
  view.rerender({ prefix: 'new-folder/' });
  await waitFor(() => expect(view.result.current.data?.objects[0].key).toBe('new-folder/current'));
  await act(async () => { nextPage.resolve(listing('old-page')); await loading; });
  expect(view.result.current.data?.objects.map(object => object.key)).toEqual(['new-folder/current']);
});

test('overlapping pagination callbacks share one request', async () => {
  const nextPage = Promise.withResolvers<ListObjectsResult>();
  vi.mocked(objectApi.listObjects)
    .mockResolvedValueOnce({ ...listing('first'), next_continuation_token: 'cursor', is_truncated: true })
    .mockReturnValueOnce(nextPage.promise);
  const view = renderHook(() => useObjects('bucket', 'us-east-1'));
  await waitFor(() => expect(view.result.current.hasMore).toBe(true));
  let first: Promise<void>;
  let second: Promise<void>;
  act(() => { first = view.result.current.loadMore(); second = view.result.current.loadMore(); });
  await act(async () => { nextPage.resolve(listing('second')); await Promise.all([first, second]); });
  expect(objectApi.listObjects).toHaveBeenCalledTimes(2);
  expect(view.result.current.data?.objects.map(object => object.key)).toEqual(['first', 'second']);
});
