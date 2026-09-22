import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import CrossProfileCopyDialog from '@/components/dialogs/CrossProfileCopyDialog';
import { operationsApi } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

vi.mock('@/lib/tauri', () => ({ operationsApi: { copyBetweenProfiles: vi.fn() } }));
vi.mock('@/store/transferStore', () => ({ useTransferStore: { getState: () => ({ refreshJobs: vi.fn() }) } }));
const items = [{ profileId: 'a', bucket: 'source', region: 'us-east-1', key: 'photo.png', isFolder: false }];
const props = { items, bucket: 'destination', region: 'auto', prefix: 'photos/', profileId: 'b', onClose: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  useProfileStore.getState().setProfiles(['a', 'b'].map(id => ({ id, name: id === 'a' ? 'AWS' : 'R2', credential_type: { type: 'Environment' }, is_default: false })));
  vi.mocked(operationsApi.copyBetweenProfiles).mockResolvedValue(1);
});
test('confirmation shows source and exact destination and cancel never copies', () => {
  render(<CrossProfileCopyDialog {...props} />);
  expect(screen.getByText('From: AWS')).toBeTruthy();
  expect(screen.getByText('To: R2 / s3://destination/photos/')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(operationsApi.copyBetweenProfiles).not.toHaveBeenCalled();
});
test('confirmation is single-flight and disables all dismissal while preparing', async () => {
  let resolve!: (count: number) => void;
  vi.mocked(operationsApi.copyBetweenProfiles).mockReturnValue(new Promise(r => { resolve = r; }));
  render(<CrossProfileCopyDialog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy to destination' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy to destination' }));
  expect(operationsApi.copyBetweenProfiles).toHaveBeenCalledExactlyOnceWith(items, 'destination', 'auto', 'photos/', 'b');
  expect((screen.getByRole('button', { name: 'close' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => resolve(1));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
});
test('preflight errors remain visible and permit retry', async () => {
  vi.mocked(operationsApi.copyBetweenProfiles).mockRejectedValue(new Error('Source permission denied'));
  render(<CrossProfileCopyDialog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy to destination' }));
  await screen.findByText(/Source permission denied/);
  expect(props.onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Copy to destination' }) as HTMLButtonElement).disabled).toBe(false);
});
test('a missing profile cannot queue copies', () => {
  useProfileStore.getState().setProfiles([]);
  render(<CrossProfileCopyDialog {...props} />);
  expect((screen.getByRole('button', { name: 'Copy to destination' }) as HTMLButtonElement).disabled).toBe(true);
});
