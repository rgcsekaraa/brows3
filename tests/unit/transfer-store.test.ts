import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { transferApi, type TransferJob } from '@/lib/tauri';
import { useTransferStore } from '@/store/transferStore';

vi.mock('@/lib/tauri', () => ({ transferApi: { listTransfers: vi.fn(), removeTransfer: vi.fn(), cancelTransfer: vi.fn(), retryTransfer: vi.fn() } }));

const job = (id: string, createdAt = 1): TransferJob => ({ id, profile_id: 'profile-a', bucket: 'bucket', bucket_region: 'us-east-1', key: `${id}.txt`, local_path: `/downloads/${id}.txt`, transfer_type: 'Download', status: 'Pending', total_bytes: 100, processed_bytes: 0, created_at: createdAt });
beforeEach(() => useTransferStore.setState({ jobs: [], jobsMap: new Map(), isPanelOpen: false, isPanelHidden: false }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test('duplicate events keep one transfer and updates keep list and lookup consistent', () => {
  const transfer = job('one');
  const store = useTransferStore.getState();
  store.addJob(transfer);
  store.addJob(transfer);
  store.updateJob({ job_id: 'one', processed_bytes: 100, total_bytes: 100, status: 'Completed', finished_at: 25 });
  const state = useTransferStore.getState();
  expect(state.jobs).toHaveLength(1);
  expect(state.jobs[0]).toEqual(expect.objectContaining({ profile_id: 'profile-a', status: 'Completed', finished_at: 25 }));
  expect(state.jobsMap.get('one')).toBe(state.jobs[0]);
});

test('newly discovered transfers are ordered by creation time', () => {
  useTransferStore.getState().upsertJob(job('older', 1));
  useTransferStore.getState().upsertJob(job('newer', 2));
  useTransferStore.getState().upsertJob({ ...job('older', 1), status: { Failed: 'Connection lost' } });
  expect(useTransferStore.getState().jobs.map(item => item.id)).toEqual(['newer', 'older']);
  expect(useTransferStore.getState().jobsMap.get('older')?.status).toEqual({ Failed: 'Connection lost' });
});

test('an older refresh cannot replace a newer transfer response', async () => {
  const first = Promise.withResolvers<TransferJob[]>();
  const second = Promise.withResolvers<TransferJob[]>();
  vi.mocked(transferApi.listTransfers).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const oldRefresh = useTransferStore.getState().refreshJobs();
  const newRefresh = useTransferStore.getState().refreshJobs();
  second.resolve([{ ...job('one'), status: 'Completed' }]);
  await newRefresh;
  first.resolve([job('one')]);
  await oldRefresh;
  expect(useTransferStore.getState().jobs[0].status).toBe('Completed');
});

test('failed refreshes preserve the existing transfer list', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useTransferStore.getState().setJobs([job('one')]);
  vi.mocked(transferApi.listTransfers).mockRejectedValueOnce(new Error('Offline'));
  await useTransferStore.getState().refreshJobs();
  expect(useTransferStore.getState().jobs.map(item => item.id)).toEqual(['one']);
});

test('a delayed snapshot cannot regress completion, remove additions, or resurrect removals', async () => {
  const pending = Promise.withResolvers<TransferJob[]>();
  useTransferStore.getState().setJobs([job('one'), job('removed')]);
  vi.mocked(transferApi.listTransfers).mockReturnValueOnce(pending.promise);
  const refresh = useTransferStore.getState().refreshJobs();
  useTransferStore.getState().updateJob({ job_id: 'one', processed_bytes: 100, total_bytes: 100, status: 'Completed' });
  useTransferStore.getState().addJob(job('new'));
  vi.mocked(transferApi.removeTransfer).mockResolvedValueOnce(true);
  await useTransferStore.getState().removeJob('removed');
  pending.resolve([job('one'), job('removed')]);
  await refresh;
  expect(useTransferStore.getState().jobsMap.get('one')?.status).toBe('Completed');
  expect(useTransferStore.getState().jobsMap.has('new')).toBe(true);
  expect(useTransferStore.getState().jobsMap.has('removed')).toBe(false);
});

test('history is only removed after the backend accepts removal', async () => {
  useTransferStore.getState().setJobs([job('one'), job('two')]);
  vi.mocked(transferApi.removeTransfer).mockRejectedValueOnce(new Error('Removal failed'));
  await expect(useTransferStore.getState().removeJob('one')).rejects.toThrow('Removal failed');
  expect(useTransferStore.getState().jobsMap.has('one')).toBe(true);
  vi.mocked(transferApi.removeTransfer).mockResolvedValueOnce(true);
  await useTransferStore.getState().removeJob('one');
  expect(useTransferStore.getState().jobs.map(item => item.id)).toEqual(['two']);
  expect(useTransferStore.getState().jobsMap.has('one')).toBe(false);
});

test('unknown progress events share one recovery refresh', async () => {
  vi.useFakeTimers();
  vi.mocked(transferApi.listTransfers).mockResolvedValueOnce([job('missing')]);
  for (let index = 0; index < 20; index += 1) {
    useTransferStore.getState().updateJob({ job_id: 'missing', processed_bytes: index, total_bytes: 100, status: 'InProgress' });
  }
  await vi.advanceTimersByTimeAsync(500);
  expect(transferApi.listTransfers).toHaveBeenCalledTimes(1);
  expect(useTransferStore.getState().jobsMap.has('missing')).toBe(true);
});
