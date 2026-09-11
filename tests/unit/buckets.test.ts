import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bucketApi, type BucketWithRegion } from '@/lib/tauri';
import { getBucketCacheInfo, invalidateBucketCache, useBuckets } from '@/hooks/useBuckets';
import { useProfileStore } from '@/store/profileStore';

vi.mock('@/lib/tauri', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/tauri')>(), bucketApi: { listBucketsWithRegions: vi.fn(), refreshS3Client: vi.fn().mockResolvedValue(undefined) } }));
const bucket = (name: string): BucketWithRegion => ({ name, region: 'us-east-1', creation_date: null, object_count: null, total_size: null, total_size_formatted: null });
beforeEach(() => {
  invalidateBucketCache();
  useProfileStore.getState().setActiveProfileId('a');
  vi.mocked(bucketApi.listBucketsWithRegions).mockResolvedValue([bucket('first')]);
});
afterEach(() => vi.restoreAllMocks());

test('Strict Mode and multiple consumers share a single discovery request', async () => {
  const pending = Promise.withResolvers<BucketWithRegion[]>();
  vi.mocked(bucketApi.listBucketsWithRegions).mockReturnValueOnce(pending.promise);
  const first = renderHook(() => useBuckets(), { wrapper: StrictMode });
  const second = renderHook(() => useBuckets());
  await act(async () => pending.resolve([bucket('first')]));
  expect(first.result.current.buckets[0].name).toBe('first');
  expect(second.result.current.buckets[0].name).toBe('first');
  expect(bucketApi.listBucketsWithRegions).toHaveBeenCalledTimes(1);
});

test('late discovery responses cannot replace another profile bucket list', async () => {
  const pending = Promise.withResolvers<BucketWithRegion[]>();
  vi.mocked(bucketApi.listBucketsWithRegions).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([bucket('second')]);
  const view = renderHook(() => useBuckets());
  act(() => useProfileStore.getState().setActiveProfileId('b'));
  await waitFor(() => expect(view.result.current.buckets[0]?.name).toBe('second'));
  await act(async () => pending.resolve([bucket('first')]));
  expect(view.result.current.buckets[0].name).toBe('second');
  expect(getBucketCacheInfo('a').isCached).toBe(false);
});

test('discovery uses its cache until the thirty minute expiry', async () => {
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const first = renderHook(() => useBuckets());
  await waitFor(() => expect(first.result.current.buckets).toHaveLength(1));
  first.unmount();
  const cached = renderHook(() => useBuckets());
  expect(cached.result.current.buckets[0].name).toBe('first');
  expect(bucketApi.listBucketsWithRegions).toHaveBeenCalledTimes(1);
  cached.unmount();
  now += 30 * 60 * 1000;
  vi.mocked(bucketApi.listBucketsWithRegions).mockResolvedValueOnce([bucket('fresh')]);
  const expired = renderHook(() => useBuckets());
  await waitFor(() => expect(expired.result.current.buckets[0]?.name).toBe('fresh'));
  expect(bucketApi.listBucketsWithRegions).toHaveBeenCalledTimes(2);
});

test('disabled discovery does not make requests until explicitly enabled', async () => {
  const view = renderHook(({ enabled }) => useBuckets({ enabled }), { initialProps: { enabled: false } });
  expect(bucketApi.listBucketsWithRegions).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.buckets).toHaveLength(1));
});
