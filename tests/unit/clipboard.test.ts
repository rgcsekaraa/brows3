import { beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useClipboardStore } from '@/store/clipboardStore';
import { useProfileStore } from '@/store/profileStore';
import { operationsApi } from '@/lib/tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const item = { profileId: 'a', bucket: 'shared-name', region: 'us-east-1', key: 'file.txt', isFolder: false };

beforeEach(() => {
  Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true });
  window.localStorage.clear();
  useClipboardStore.getState().clear();
  useProfileStore.getState().setActiveProfileId('a');
});

test('copy and cut retain their profile and clear when switching profiles', () => {
  for (const action of ['copy', 'cut'] as const) {
    useClipboardStore.getState()[action]([item]);
    useProfileStore.getState().setActiveProfileId('a');
    expect(useClipboardStore.getState().items).toEqual([item]);
    useProfileStore.getState().setActiveProfileId('b');
    expect(useClipboardStore.getState().items).toEqual([]);
    useProfileStore.getState().setActiveProfileId('a');
  }
});

test('legacy clipboard entries without a profile are discarded on hydration', async () => {
  window.localStorage.setItem('brows3-clipboard', JSON.stringify({ version: 0, state: { items: [{ key: 'file.txt' }], mode: 'move' } }));
  await useClipboardStore.persist.rehydrate();
  expect(useClipboardStore.getState().items).toEqual([]);
});

test('copy and move reject another profile before reaching native IPC', async () => {
  useProfileStore.getState().setActiveProfileId('b');
  for (const action of ['copyObject', 'moveObject'] as const) {
    await expect(operationsApi[action]('shared-name', 'us-east-1', 'file.txt', 'shared-name', 'us-east-1', 'copy.txt', 'a')).rejects.toThrow('active profile changed');
  }
  expect(invoke).not.toHaveBeenCalled();
});

test('valid copy and move send the captured profile to native IPC', async () => {
  for (const action of ['copyObject', 'moveObject'] as const) {
    await operationsApi[action]('shared-name', 'us-east-1', 'file.txt', 'shared-name', 'us-east-1', 'copy.txt', 'a');
    expect(invoke).toHaveBeenLastCalledWith(action === 'copyObject' ? 'copy_object' : 'move_object', expect.objectContaining({ expectedProfileId: 'a', sourceKey: 'file.txt', destinationKey: 'copy.txt' }));
  }
});
