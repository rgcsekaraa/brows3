import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSavedJobEvents } from '@/hooks/useSavedJobEvents';
import { useToastStore } from '@/store/toastStore';
const mocks = vi.hoisted(() => ({ push: vi.fn(), stop: vi.fn(), callbacks: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => { mocks.callbacks.set(name, callback); return mocks.stop; }) }));
function Listener() { useSavedJobEvents(); return null; }
beforeEach(() => { mocks.callbacks.clear(); mocks.push.mockClear(); mocks.stop.mockClear(); useToastStore.getState().clearToasts(); Object.assign(window, { __TAURI__: {} }); });

test.each(['Completed', 'Failed', 'Cancelled'])('saved job %s emits the correct notification and navigation', async status => {
  const view = render(<Listener />);
  await waitFor(() => expect(mocks.callbacks.size).toBe(2));
  act(() => mocks.callbacks.get('saved-job-finished')!({ payload: { config: { name: 'Backup' }, last_run: { status, message: 'Result details' } } }));
  const toast = useToastStore.getState().toasts[0];
  expect(toast.type).toBe(status === 'Completed' ? 'success' : 'error');
  expect(toast.message).toBe(`Backup: ${status}`);
  expect(toast.details).toBe('Result details');
  toast.action?.onClick(); expect(mocks.push).toHaveBeenCalledWith('/jobs');
  view.unmount(); expect(mocks.stop).toHaveBeenCalledTimes(2);
  act(() => mocks.callbacks.get('saved-job-finished')!({ payload: {} }));
  expect(useToastStore.getState().toasts).toHaveLength(1);
});

test('storage failures remain visible and late listener registration is cleaned up', async () => {
  const view = render(<Listener />);
  act(() => mocks.callbacks.get('saved-job-storage-error')!({ payload: 'Disk full. Scheduling stopped.' }));
  expect(useToastStore.getState().toasts[0].autoHide).toBe(false);
  view.unmount();
  await waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(2));
});
