import { expect, test } from 'vitest';
import type { TransferJob } from '@/lib/tauri';
import { formatTransferSpeed, totalTransferSpeed, transferSpeed } from '@/lib/transferSpeed';
import { useTransferStore } from '@/store/transferStore';

const job = (overrides: Partial<TransferJob> = {}): TransferJob => ({
  id: 'speed-test', profile_id: 'a', bucket: 'bucket', bucket_region: null,
  key: 'file', local_path: '/tmp/file', transfer_type: 'Upload',
  status: 'InProgress', total_bytes: 10000, processed_bytes: 1000,
  bytes_per_second: 1024, created_at: 1, ...overrides,
});

test('speed formatting adapts units and rejects invalid values', () => {
  expect(formatTransferSpeed(0)).toBe('0 B/s');
  expect(formatTransferSpeed(NaN)).toBe('0 B/s');
  expect(formatTransferSpeed(-1)).toBe('0 B/s');
  expect(formatTransferSpeed(Infinity)).toBe('0 B/s');
  expect(formatTransferSpeed(512)).toBe('512 B/s');
  expect(formatTransferSpeed(1536)).toBe('1.5 KB/s');
  expect(formatTransferSpeed(2 * 1024 ** 2)).toBe('2.0 MB/s');
});

test('totals separate directions and exclude inactive jobs and group roots', () => {
  const jobs = [job(), job({ transfer_type: 'Download', bytes_per_second: 2048 }),
    job({ status: 'Completed' }), job({ status: 'Pending' }), job({ status: 'Cancelled' }),
    job({ status: { Failed: 'offline' } }), job({ is_group_root: true })];
  expect(totalTransferSpeed(jobs)).toBe(3072);
  expect(totalTransferSpeed(jobs, 'Upload')).toBe(1024);
  expect(totalTransferSpeed(jobs, 'Download')).toBe(2048);
  expect(transferSpeed(job({ bytes_per_second: undefined }))).toBe(0);
});

test('speed-only events update the store and completion clears the rate', () => {
  useTransferStore.getState().setJobs([job()]);
  const event = { job_id: 'speed-test', processed_bytes: 1000, total_bytes: 10000, status: 'InProgress' as const };
  useTransferStore.getState().updateJob({ ...event, bytes_per_second: 0 });
  expect(useTransferStore.getState().jobs[0].bytes_per_second).toBe(0);
  useTransferStore.getState().updateJob({ ...event, bytes_per_second: 2048 });
  expect(useTransferStore.getState().jobsMap.get('speed-test')?.bytes_per_second).toBe(2048);
  useTransferStore.getState().updateJob({ ...event, status: 'Completed', bytes_per_second: 2048 });
  expect(useTransferStore.getState().jobs[0].bytes_per_second).toBe(0);
  useTransferStore.getState().setJobs([]);
});
