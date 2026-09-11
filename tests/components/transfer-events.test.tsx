import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { useTransferEvents } from '@/hooks/useTransferEvents';

const store = vi.hoisted(() => ({ updateJob: vi.fn(), upsertJob: vi.fn(), refreshJobs: vi.fn() }));
vi.mock('@/store/transferStore', () => ({ useTransferStore: () => store }));
vi.mock('@/lib/tauri', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const listeners = new Map<string, (event: Event<unknown>) => void>();
beforeEach(() => {
  listeners.clear();
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    listeners.set(name, handler);
    return () => { if (listeners.get(name) === handler) listeners.delete(name); };
  });
});

test('Strict Mode keeps one set of live listeners and cleans them up on unmount', async () => {
  const view = renderHook(() => useTransferEvents(), { wrapper: StrictMode });
  await waitFor(() => expect(listeners.size).toBe(2));
  const payload = { job_id: 'job', status: 'Completed', processed_bytes: 1, total_bytes: 1, finished_at: 1 };
  act(() => listeners.get('transfer-update')?.({ event: 'transfer-update', id: 1, payload }));
  expect(store.updateJob).toHaveBeenCalledExactlyOnceWith(payload);
  view.unmount();
  expect(listeners.size).toBe(0);
});

test('a listener registered after unmount is immediately removed', async () => {
  const pending = Promise.withResolvers<UnlistenFn>();
  const unlisten = vi.fn();
  vi.mocked(listen).mockReturnValueOnce(pending.promise);
  const view = renderHook(() => useTransferEvents());
  view.unmount();
  await act(async () => pending.resolve(unlisten));
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledTimes(1);
});
