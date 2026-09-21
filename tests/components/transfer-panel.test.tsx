import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { TransferPanel } from '@/components/transfer/TransferPanel';
import { useTransferStore } from '@/store/transferStore';
import type { TransferJob } from '@/lib/tauri';

const job = (type: 'Upload' | 'Download', status: TransferJob['status'] = 'InProgress'): TransferJob => ({
  id: type, profile_id: 'a', transfer_type: type, status, bucket: 'test', bucket_region: null,
  key: 'file', local_path: '/tmp/file', total_bytes: 10000, processed_bytes: 1000, bytes_per_second: 1024, created_at: 1,
});
afterEach(() => { cleanup(); useTransferStore.getState().setJobs([]); });

for (const type of ['Upload', 'Download'] as const) {
  test(`${type} alone hides the opposite direction, even with finished history`, () => {
    const other = type === 'Upload' ? 'Download' : 'Upload';
    useTransferStore.setState({ jobs: [job(type), job(other, 'Completed')], isPanelOpen: false, isPanelHidden: false });
    const view = render(<TransferPanel />);
    expect(view.container.querySelector('.MuiBadge-root')).toBeNull();
    expect(screen.getByText('1 active')).toBeTruthy();
    expect(screen.getByText(`${type}: 1.0 KB/s`)).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${other}:`))).toBeNull();
  });
}

test('both directions appear when both have work, including queued work', () => {
  useTransferStore.setState({ jobs: [job('Upload'), job('Download', 'Pending')], isPanelOpen: false, isPanelHidden: false });
  render(<TransferPanel />);
  expect(screen.getByText('Upload: 1.0 KB/s')).toBeTruthy();
  expect(screen.getByText('Download: 0 B/s')).toBeTruthy();
});
