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
  expect(syncApi.preview).toHaveBeenCalledWith('/local', 'bucket', undefined, 'dest/', 'a', { include: [], exclude: [], skip_existing: false });
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

test('editing filter rules invalidates the preview and preserves literal spaces', async () => {
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  await showPreview(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Include patterns'), { target: { value: '**/*.txt\n\n spaced name ' } });
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Exclude patterns'), { target: { value: 'cache/**' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByText('dest/file');
  expect(syncApi.preview).toHaveBeenLastCalledWith('/local', 'bucket', undefined, 'dest/', 'a', { include: ['**/*.txt', ' spaced name '], exclude: ['cache/**'], skip_existing: false });
});

test('skip existing mode invalidates approval and can queue only new files without replacement', async () => {
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  await showPreview(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Existing objects' }));
  fireEvent.click(screen.getByRole('option', { name: 'Skip all existing objects' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  vi.mocked(syncApi.preview).mockResolvedValue({ ...preview, changed_files: 0, skipped_files: 1, new_files: 1, entries: [{ key: 'new', action: 'New', size: 5 }, { key: 'dest/file', action: 'Skipped', size: 5 }] });
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByText('Skipped');
  expect(syncApi.preview).toHaveBeenLastCalledWith('/local', 'bucket', undefined, 'dest/', 'a', { include: [], exclude: [], skip_existing: true });
  fireEvent.click(screen.getByRole('button', { name: 'Start sync' }));
  await waitFor(() => expect(syncApi.start).toHaveBeenCalledWith('plan', false, 'a'));
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

test('failed preview leaves Start disabled and exposes the error', async () => {
  vi.mocked(syncApi.preview).mockRejectedValue(new Error('Access denied. Check S3 permissions.'));
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' })); await screen.findByText('/local');
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByText(/Access denied/);
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
  expect(syncApi.start).not.toHaveBeenCalled();
});

test('expired plan requires a fresh preview instead of replaying approval', async () => {
  vi.mocked(syncApi.start).mockRejectedValue(new Error('Preview expired. Preview again.'));
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  await showPreview(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Start sync' }));
  await screen.findByText(/Preview expired. Preview again./);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
});

test('unchanged and empty folders never enable Start', async () => {
  vi.mocked(syncApi.preview).mockResolvedValue({ ...preview, changed_files: 0, unchanged_files: 1, upload_bytes: 0, entries: [{ key: 'dest/file', size: 5, action: 'Unchanged' }] });
  render(<FolderSyncDialog bucket="bucket" prefix="dest/" profileId="a" onClose={vi.fn()} />);
  await showPreview();
  await screen.findByText('No uploads are needed with these rules. Review the actions below.');
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
  vi.mocked(syncApi.preview).mockResolvedValue({ ...preview, changed_files: 0, entries: [], upload_bytes: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByText('This local folder contains no files. Nothing to upload.');
  expect((screen.getByRole('button', { name: 'Start sync' }) as HTMLButtonElement).disabled).toBe(true);
});
