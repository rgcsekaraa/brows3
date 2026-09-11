import { expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { operationsApi, subscribeCacheInvalidation } from '@/lib/tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

test('a failed bulk delete refreshes views and still reports the error', async () => {
  Object.defineProperty(window, '__TAURI__', { value: {}, configurable: true });
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Some objects could not be deleted'));
  const invalidated = vi.fn();
  const unsubscribe = subscribeCacheInvalidation(invalidated);
  try {
    await expect(operationsApi.deleteObjects('bucket', 'region', ['one', 'two'])).rejects.toThrow('Some objects could not be deleted');
    expect(invalidated).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});
