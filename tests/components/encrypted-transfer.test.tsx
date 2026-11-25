import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import ProtectedBucket from '@/components/transfer/ProtectedBucket';
import BucketManagementDialog from '@/components/dialogs/BucketManagementDialog';
import { validPrivateLabel, validProtectedBucket, validTransferPassphrase, watchSessionExpiry } from '@/lib/encryptedTransfer';
import { useProfileStore } from '@/store/profileStore';
import { useToastStore } from '@/store/toastStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@/hooks/useObjects', () => ({ useObjects: () => ({ data: { objects: [{ key: 'report' }], common_prefixes: ['.brows3/'] }, refresh: vi.fn() }) }));
const scope = { bucketName: 'b3e1-' + 'a'.repeat(32), bucketRegion: 'us-east-2', expectedProfileId: 'work' };
const passphrase = '  spaces are significant  ';
const session = { sessionToken: 'ephemeral-token', label: 'Private label' };

beforeEach(() => {
  vi.stubGlobal('__TAURI__', {});
  vi.mocked(invoke).mockReset();
  useProfileStore.getState().setActiveProfileId('work');
  useToastStore.getState().clearToasts();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function unlock() {
  vi.mocked(invoke).mockResolvedValueOnce({ ...session, expiresAtMs: Date.now() + 900_000 });
  const view = render(<ProtectedBucket scope={scope} prefix="" />);
  expect(screen.queryByText(session.label)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Bucket passphrase'), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock bucket' }));
  await screen.findByText(session.label);
  expect(invoke).toHaveBeenCalledWith('unlock_encrypted_bucket', { ...scope, passphrase });
  expect(screen.queryByText('.brows3/')).toBeNull();
  return view;
}

test('creation requires an explicit choice and submits private label only to encrypted provisioning', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(scope.bucketName);
  const onClose = vi.fn();
  render(<BucketManagementDialog action={{ mode: 'create', profileId: 'work', region: 'us-east-2' }} onClose={onClose} />);
  expect(screen.getByText('Would you like this entire bucket to be end-to-end encrypted?')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /Yes, create/ }));
  fireEvent.change(screen.getByLabelText('Private display name'), { target: { value: session.label } });
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: passphrase } });
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(vi.mocked(invoke).mock.calls).toEqual([['create_encrypted_bucket', { bucketName: session.label, region: 'us-east-2', expectedProfileId: 'work', passphrase }]]);
  expect(useToastStore.getState().toasts[0].message).toContain(scope.bucketName);
  expect(useToastStore.getState().toasts[0].message).not.toContain(session.label);
});

test('upload reports success only after authenticated transfer completes, then lock removes local label', async () => {
  await unlock();
  vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce('C:\\docs\\report');
  const upload = screen.getByRole('button', { name: 'Upload' });
  await act(async () => { fireEvent.click(upload); });
  expect(invoke).toHaveBeenCalledTimes(1);
  const pending = Promise.withResolvers<void>();
  vi.mocked(invoke).mockReturnValueOnce(pending.promise);
  fireEvent.click(upload);
  await screen.findByText('Encrypting and uploading…');
  expect(invoke).toHaveBeenCalledWith('upload_encrypted_file', { ...scope, key: 'report', localPath: 'C:\\docs\\report', sessionToken: session.sessionToken });
  expect(useToastStore.getState().toasts).toHaveLength(0);
  await act(async () => pending.resolve());
  expect(useToastStore.getState().toasts[0].type).toBe('success');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lock bucket' })); });
  expect(invoke).toHaveBeenCalledWith('lock_encrypted_bucket', { sessionToken: session.sessionToken });
  expect(screen.queryByText(session.label)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
});

test('failed authentication cannot retry as an ordinary download', async () => {
  await unlock();
  vi.mocked(save).mockResolvedValueOnce('/tmp/report');
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Authentication failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Download report' }));
  await waitFor(() => expect(useToastStore.getState().toasts[0]?.type).toBe('error'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('lock_encrypted_bucket', { sessionToken: session.sessionToken }));
  expect(vi.mocked(invoke).mock.calls.slice(1)).toEqual([['download_encrypted_file', { ...scope, key: 'report', localPath: '/tmp/report', sessionToken: session.sessionToken }], ['lock_encrypted_bucket', { sessionToken: session.sessionToken }]]);
  expect(screen.queryByText(session.label)).toBeNull();
});

test('session deadline and resume both trigger relock', () => {
  vi.useFakeTimers();
  const expire = vi.fn();
  const stop = watchSessionExpiry(Date.now() + 50, expire);
  try {
    vi.advanceTimersByTime(49);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('focus'));
    expect(expire).toHaveBeenCalledTimes(2);
  } finally { stop(); vi.useRealTimers(); }
});

test('resume after expiry hides the unlocked label and transfer controls without another transfer', async () => {
  await unlock();
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 901_000);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.queryByText(session.label)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(invoke).toHaveBeenCalledWith('lock_encrypted_bucket', { sessionToken: session.sessionToken });
  } finally { vi.useRealTimers(); }
});

test('private label, physical address and password have distinct bounds', () => {
  expect(validProtectedBucket(scope.bucketName)).toBe(true);
  expect(validProtectedBucket('b3e1-private')).toBe(false);
  expect(validPrivateLabel('🔒'.repeat(32))).toBe(true);
  expect(validPrivateLabel('🔒'.repeat(33))).toBe(false);
  expect(validTransferPassphrase('🔒'.repeat(3))).toBe(true);
  expect(validTransferPassphrase('a'.repeat(11))).toBe(false);
});
