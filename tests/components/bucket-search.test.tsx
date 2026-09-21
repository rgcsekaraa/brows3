import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import BucketPage from '@/app/bucket/page';
import { objectApi, operationsApi, transferApi, type S3Object, type SearchObjectsResult } from '@/lib/tauri';
import { useProfileStore } from '@/store/profileStore';
import { useClipboardStore } from '@/store/clipboardStore';

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
  return {
    ...actual,
    objectApi: { ...actual.objectApi, searchObjects: vi.fn(), listObjects: vi.fn() },
    operationsApi: { ...actual.operationsApi, deleteObjects: vi.fn().mockResolvedValue(undefined) },
    transferApi: { ...actual.transferApi, queueDownload: vi.fn().mockResolvedValue('job'), queueFolderDownload: vi.fn().mockResolvedValue(1) },
  };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue('/tmp/downloads'), save: vi.fn().mockResolvedValue(null) }));
vi.mock('@/components/dialogs/PropertiesDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/PermissionsDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/ObjectPreviewDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/PresignedUrlDialog', () => ({ default: () => null }));
vi.mock('@/components/common/StyledCheckbox', () => ({ StyledCheckbox: (props: { checked: boolean; onChange: React.ChangeEventHandler<HTMLInputElement> }) => <input type="checkbox" aria-label="Deep search" {...props} /> }));
vi.mock('@/components/common/VirtualizedObjectTable', () => ({
  VirtualizedObjectTable: ({ objects, onSelect }: { objects: S3Object[]; onSelect: (key: string, checked: boolean) => void }) => <ul>{objects.map(object => <li key={object.key}><input type="checkbox" aria-label={`Select ${object.key}`} onChange={event => onSelect(object.key, event.target.checked)} /><button onClick={() => onSelect(object.key, true)}>{object.key}</button></li>)}</ul>,
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

test.each([0, 42])('downloads a selected deep result with size %s', async size => {
  vi.mocked(objectApi.searchObjects).mockResolvedValue({ ...result, objects: [{ ...result.objects[0], size }] });
  render(<BucketPage />);
  search();
  fireEvent.click(await screen.findByText('nested/match.txt'));
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(transferApi.queueDownload).toHaveBeenCalledWith('a', 'us-east-1', 'nested/match.txt', '/tmp/downloads/match.txt', size, false, 'a'));
});


test('a failed recursive listing prevents all deletion', async () => {
  vi.mocked(objectApi.searchObjects).mockResolvedValue({ ...result, objects: [{ ...result.objects[0], key: 'folder/' }] });
  vi.mocked(objectApi.listObjects)
    .mockResolvedValueOnce({ objects: result.objects, common_prefixes: [], next_continuation_token: 'next', is_truncated: true, prefix: 'folder/' })
    .mockRejectedValueOnce(new Error('Listing denied'));
  const loggedError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<BucketPage />);
  search();
  fireEvent.click(await screen.findByText('folder/'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));
  await waitFor(() => expect(objectApi.listObjects).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(loggedError).toHaveBeenCalled());
  expect(operationsApi.deleteObjects).not.toHaveBeenCalled();
  expect(screen.getByText('1 selected')).toBeTruthy();
  loggedError.mockRestore();
});

test('a profile change during recursive enumeration cannot redirect deletion', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof objectApi.listObjects>>>();
  vi.mocked(objectApi.searchObjects).mockResolvedValue({ ...result, objects: [{ ...result.objects[0], key: 'folder/' }] });
  vi.mocked(objectApi.listObjects).mockReturnValueOnce(pending.promise);
  const loggedError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<BucketPage />);
  search();
  fireEvent.click(await screen.findByText('folder/'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete/ }));
  await waitFor(() => expect(objectApi.listObjects).toHaveBeenCalledTimes(1));
  act(() => useProfileStore.getState().setActiveProfileId('b'));
  await act(async () => pending.resolve({ objects: result.objects, common_prefixes: [], next_continuation_token: null, is_truncated: false, prefix: 'folder/' }));
  expect(operationsApi.deleteObjects).not.toHaveBeenCalled();
  loggedError.mockRestore();
});


test.each(['c', 'x'])('object clipboard shortcut %s works from a focused selection checkbox', async key => {
  useClipboardStore.getState().clear();
  render(<BucketPage />);
  const checkbox = screen.getByRole('checkbox', { name: 'Select root.txt' });
  fireEvent.click(checkbox);
  checkbox.focus();
  fireEvent.keyDown(checkbox, { key, ctrlKey: true });
  expect(useClipboardStore.getState().items).toEqual([{ profileId: 'a', bucket: 'a', region: 'us-east-1', key: 'root.txt', isFolder: false }]);
  expect(useClipboardStore.getState().mode).toBe(key === 'c' ? 'copy' : 'move');
});
