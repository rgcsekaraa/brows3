import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import VersionHistoryDialog from '@/components/dialogs/VersionHistoryDialog';
import { versionsApi, type VersionHistory } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({ versionsApi: { list: vi.fn(), restore: vi.fn() } }));
vi.mock('@/store/transferStore', () => ({ useTransferStore: { getState: () => ({ refreshJobs: vi.fn() }) } }));
const history: VersionHistory = { versioning: 'Enabled', next: null, versions: [
  { version_id: 'latest', is_latest: true, is_delete_marker: false, size: 5, modified: null, etag: 'current' },
  { version_id: 'old-version', is_latest: false, is_delete_marker: false, size: 0, modified: null, etag: 'old' },
  { version_id: 'marker', is_latest: false, is_delete_marker: true, size: null, modified: null, etag: null },
] };
const props = { bucket: 'bucket', region: 'us-east-1', profileId: 'a', initialKey: 'file', onClose: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(versionsApi.list).mockResolvedValue(history); vi.mocked(versionsApi.restore).mockResolvedValue('job'); });
async function selectOld() { await screen.findByText('old-version'); fireEvent.click(screen.getByRole('button', { name: 'Select version old-version' })); }

test('restoring needs an older data version and explicit approval', async () => {
  render(<VersionHistoryDialog {...props} />);
  await selectOld();
  expect((screen.getByRole('button', { name: 'Select version latest' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Select version marker' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Restore selected version' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
  await waitFor(() => expect(versionsApi.restore).toHaveBeenCalledExactlyOnceWith('bucket', 'us-east-1', 'file', 'old-version', 'latest', true, 'a'));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
});
test('suspended versioning remains read-only and does not silently enable versioning', async () => {
  vi.mocked(versionsApi.list).mockResolvedValue({ ...history, versioning: 'Suspended' });
  render(<VersionHistoryDialog {...props} />);
  await screen.findByText(/Bucket versioning is suspended/);
  expect((screen.getByRole('button', { name: 'Select version old-version' }) as HTMLButtonElement).disabled).toBe(true);
  expect(versionsApi.restore).not.toHaveBeenCalled();
});
test('changing the exact key clears history and approval without normalizing spaces', async () => {
  render(<VersionHistoryDialog {...props} />); await selectOld(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Exact object key'), { target: { value: ' file ' } });
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load history' }));
  await waitFor(() => expect(versionsApi.list).toHaveBeenLastCalledWith('bucket', 'us-east-1', ' file ', null, 'a'));
});
test('stale restore failure discards history and requires fresh confirmation', async () => {
  vi.mocked(versionsApi.restore).mockRejectedValue(new Error('Current version changed. Refresh history.'));
  render(<VersionHistoryDialog {...props} />); await selectOld(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
  await screen.findByText(/Current version changed/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
});
test('deleted objects retain their current marker as the restore guard', async () => {
  vi.mocked(versionsApi.list).mockResolvedValue({ ...history, versions: [{ ...history.versions[2], is_latest: true }, history.versions[1]] });
  render(<VersionHistoryDialog {...props} />); await selectOld();
  await screen.findByText(/currently deleted/);
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Restore selected version' }));
  await waitFor(() => expect(versionsApi.restore).toHaveBeenCalledWith('bucket', 'us-east-1', 'file', 'old-version', 'marker', true, 'a'));
});
test('pagination carries both markers and Previous restores the cached page', async () => {
  const cursor = { key_marker: 'file', version_id_marker: 'old-version' };
  vi.mocked(versionsApi.list).mockResolvedValueOnce({ ...history, next: cursor }).mockResolvedValueOnce({ ...history, versions: [{ ...history.versions[1], version_id: 'older' }] });
  render(<VersionHistoryDialog {...props} />); await screen.findByText('old-version');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('older');
  expect(versionsApi.list).toHaveBeenLastCalledWith('bucket', 'us-east-1', 'file', cursor, 'a');
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('old-version');
});
test('closing during a read cannot queue a late restore', async () => {
  let resolve!: (value: VersionHistory) => void;
  vi.mocked(versionsApi.list).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<VersionHistoryDialog {...props} />); view.unmount();
  await act(async () => resolve(history));
  expect(versionsApi.restore).not.toHaveBeenCalled();
});
test('permission errors are visible rather than reported as empty history', async () => {
  vi.mocked(versionsApi.list).mockRejectedValue(new Error('AccessDenied: ListBucketVersions'));
  render(<VersionHistoryDialog {...props} />);
  await screen.findByText(/AccessDenied/);
  expect(screen.queryByText(/No versions found/)).toBeNull();
});
