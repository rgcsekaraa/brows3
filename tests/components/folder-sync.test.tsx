import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import FolderSyncDialog from '@/components/dialogs/FolderSyncDialog';
import { syncApi, type SyncPreview } from '@/lib/tauri';
import { open } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/lib/tauri', () => ({ syncApi: { preview: vi.fn(), start: vi.fn() } }));
vi.mock('@/store/transferStore', () => ({ useTransferStore: { getState: () => ({ refreshJobs: vi.fn() }) } }));
const preview: SyncPreview = { id: 'plan', entries: [{ key: 'dest/file', action: 'Changed', size: 5 }], new_files: 0, changed_files: 1, unverified_files: 0, unchanged_files: 0, remote_only_files: 2, upload_bytes: 5 };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(open).mockResolvedValue('/local'); vi.mocked(syncApi.preview).mockResolvedValue(preview); vi.mocked(syncApi.start).mockResolvedValue(1); });
async function showPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
  await screen.findByText('/local');
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByText('dest/file');
}
test('preview requires explicit replacement approval and preserves the destination profile', async () => {
  const close = vi.fn();
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={close} />);
  await showPreview();
  expect(syncApi.start).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm replacement of existing objects' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start sync' }));
  await waitFor(() => expect(syncApi.start).toHaveBeenCalledWith('plan', true, 'a'));
  expect(syncApi.preview).toHaveBeenCalledWith('/local', 'bucket', undefined, 'dest/', 'a');
  await waitFor(() => expect(close).toHaveBeenCalled());
});
test('refreshing preview clears replacement approval', async () => {
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  await showPreview();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByText('dest/file');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
test('late preview after closing never starts uploads', async () => {
  let resolve!: (p: SyncPreview) => void;
  vi.mocked(syncApi.preview).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' })); await screen.findByText('/local');
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  view.unmount();
  await act(async () => resolve(preview));
  expect(syncApi.start).not.toHaveBeenCalled();
});
