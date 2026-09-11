import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import { useHistoryStore } from '@/store/historyStore';
import { useProfileStore } from '@/store/profileStore';
import { useAppStore } from '@/store/appStore';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  useProfileStore.setState({ activeProfileId: 'a', profiles: [] });
  useHistoryStore.setState({ favorites: [] });
  useAppStore.setState({ tabs: [], discoveredRegions: {} });
});

test('bucket roots reopen without a prefix and stay isolated by profile', () => {
  const favorite = { key: '', name: 'demo-bucket', bucket: 'demo-bucket', region: 'garage', isFolder: true };
  useHistoryStore.getState().addFavorite({ ...favorite, profileId: 'a' });
  useHistoryStore.getState().addFavorite({ ...favorite, profileId: 'b' });
  render(<FavoritesPage />);
  expect(screen.getAllByText('demo-bucket')).toHaveLength(1);
  fireEvent.click(screen.getByText('demo-bucket'));
  expect(push).toHaveBeenCalledWith('/bucket?name=demo-bucket&region=garage');
  expect(useAppStore.getState().tabs[0].icon).toBe('bucket');
  fireEvent.click(screen.getByRole('button', { name: 'Remove demo-bucket from favorites' }));
  expect(screen.queryByText('demo-bucket')).toBeNull();
  expect(useHistoryStore.getState().favorites[0].profileId).toBe('b');
  act(() => useProfileStore.setState({ activeProfileId: 'b' }));
  expect(screen.getByText('demo-bucket')).toBeTruthy();
});
