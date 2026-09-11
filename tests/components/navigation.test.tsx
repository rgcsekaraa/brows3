import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import AppShell from '@/components/layout/AppShell';
import { useAppStore } from '@/store/appStore';

vi.mock('@/hooks/useTransferEvents', () => ({ useTransferEvents: vi.fn() }));
vi.mock('@/hooks/useClipboardShortcuts', () => ({ useClipboardShortcuts: vi.fn() }));
vi.mock('@/lib/monaco-config', () => ({ preloadMonaco: vi.fn() }));
vi.mock('@/store/profileStore', () => ({ useProfileStore: () => ({ profiles: [{ id: 'a' }], activeProfileId: 'a', setProfiles: vi.fn(), setActiveProfileId: vi.fn() }) }));
vi.mock('@/components/profile/ProfileSelector', () => ({ default: () => null }));
vi.mock('@/components/profile/ProfileDialog', () => ({ default: () => null }));
vi.mock('@/components/navigation/PathBar', () => ({ default: () => null }));
vi.mock('@/components/layout/Sidebar', () => ({ default: () => <nav aria-label="Main navigation"><a href="/settings">Settings</a></nav> }));
vi.mock('@/components/layout/Footer', () => ({ default: () => null }));
vi.mock('@/components/layout/TabBar', () => ({ default: () => null }));
vi.mock('@/components/common/ToastContainer', () => ({ default: () => null }));
vi.mock('@/components/transfer/TransferPanel', () => ({ TransferPanel: () => null }));

let width = 800;
const listeners = new Set<() => void>();
beforeEach(() => {
  width = 800;
  listeners.clear();
  useAppStore.setState({ sidebarOpen: true, themeMode: 'light' });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
    get matches() { return query === '(max-width:900px)' && width <= 900; },
    media: query,
    addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
  }) });
});

test.each([800, 900])('navigation can be opened and dismissed at %s pixels', async viewport => {
  width = viewport;
  render(<AppShell>Content</AppShell>);
  const toggle = await screen.findByRole('button', { name: 'Toggle navigation' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.click(toggle);
  expect(await screen.findByRole('navigation')).toBeTruthy();
  expect(useAppStore.getState().sidebarOpen).toBe(true);
  fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('navigation')).toBeNull());
  expect(useAppStore.getState().sidebarOpen).toBe(false);
});

test('returning to 901 pixels restores permanent navigation', async () => {
  render(<AppShell>Content</AppShell>);
  await screen.findByRole('button', { name: 'Toggle navigation' });
  act(() => { width = 901; listeners.forEach(listener => listener()); });
  expect(screen.queryByRole('button', { name: 'Toggle navigation' })).toBeNull();
  expect(screen.getByRole('navigation')).toBeTruthy();
});
