import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import BucketPage from '@/app/bucket/page';
import { objectApi, type S3Object, type SearchObjectsResult } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';

const route = vi.hoisted(() => ({ params: 'name=a&region=us-east-1', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(route.params),
  useRouter: () => ({ push: route.push }),
}));
vi.mock('@/hooks/useObjects', () => ({ useObjects: () => ({
  data: { objects: [{ key: 'root.txt', size: 10 }], common_prefixes: [] },
  isLoading: false, error: null, refresh: vi.fn(), loadMore: vi.fn(),
}) }));
vi.mock('@/lib/tauri', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>();
  return { ...actual, objectApi: { ...actual.objectApi, searchObjects: vi.fn() } };
});
vi.mock('@/components/dialogs/PropertiesDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/PermissionsDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/ObjectPreviewDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/PresignedUrlDialog', () => ({ default: () => null }));
vi.mock('@/components/common/StyledCheckbox', () => ({ StyledCheckbox: (props: { checked: boolean; onChange: React.ChangeEventHandler<HTMLInputElement> }) => <input type="checkbox" aria-label="Deep search" {...props} /> }));
vi.mock('@/components/common/VirtualizedObjectTable', () => ({
  VirtualizedObjectTable: ({ objects, onSelect }: { objects: S3Object[]; onSelect: (key: string, checked: boolean) => void }) => <ul>{objects.map(object => <li key={object.key}><button onClick={() => onSelect(object.key, true)}>{object.key}</button></li>)}</ul>,
}));

const result: SearchObjectsResult = {
  objects: [{ key: 'nested/match.txt', size: 42, last_modified: null, storage_class: null }],
  scanned_objects: 1,
  is_truncated: false,
};

beforeEach(() => {
  route.params = 'name=a&region=us-east-1';
  useProfileStore.getState().setActiveProfileId('a');
  vi.mocked(objectApi.searchObjects).mockResolvedValue(result);
});

function search() {
  fireEvent.change(screen.getByPlaceholderText('Search current folder...'), { target: { value: 'match' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Deep search' }));
}

test.each(['bucket', 'prefix', 'profile'])('discards search results and selections after changing %s', async change => {
  const view = render(<BucketPage />);
  search();
  fireEvent.click(await screen.findByText('nested/match.txt'));
  expect(screen.getByText('1 selected')).toBeTruthy();
  if (change === 'bucket') route.params = 'name=b&region=us-east-1';
  if (change === 'prefix') route.params += '&prefix=other/';
  if (change === 'profile') act(() => useProfileStore.getState().setActiveProfileId('b'));
  view.rerender(<BucketPage />);
  expect(screen.queryByText('nested/match.txt')).toBeNull();
  expect(screen.queryByText('1 selected')).toBeNull();
  expect(screen.getByText('root.txt')).toBeTruthy();
});

test('ignores a search response that arrives after navigation', async () => {
  const pending = Promise.withResolvers<SearchObjectsResult>();
  vi.mocked(objectApi.searchObjects).mockReturnValue(pending.promise);
  const view = render(<BucketPage />);
  search();
  await waitFor(() => expect(objectApi.searchObjects).toHaveBeenCalledTimes(1));
  route.params = 'name=b&region=us-east-1';
  view.rerender(<BucketPage />);
  await act(async () => pending.resolve(result));
  expect(screen.queryByText('nested/match.txt')).toBeNull();
  expect(screen.getByText('root.txt')).toBeTruthy();
});
