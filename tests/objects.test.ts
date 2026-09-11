import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useObjects } from '@/hooks/useObjects';
import { objectApi, type ListObjectsResult } from '@/lib/tauri';
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
