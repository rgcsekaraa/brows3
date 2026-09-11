import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import HomePage from '@/app/page';
import { useProfileStore } from '@/store/profileStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('view=discovery') }));
vi.mock('@/hooks/useBuckets', () => ({ useBuckets: () => ({ buckets: [], isLoading: false, refresh: vi.fn() }) }));
vi.mock('@/lib/tauri', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/tauri')>(), bucketApi: { createBucket: vi.fn(), getBucketPolicy: vi.fn() } }));

beforeEach(() => {
  useProfileStore.setState({ activeProfileId: 'a', profiles: [
    { id: 'a', name: 'First', credential_type: { type: 'Environment' }, is_default: true },
    { id: 'b', name: 'Second', credential_type: { type: 'Environment' }, is_default: false },
  ] });
});

test('profile changes discard an open bucket action and its confirmation', () => {
  render(<HomePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), { target: { value: 'old-profile-bucket' } });
  act(() => useProfileStore.setState({ activeProfileId: 'b' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => useProfileStore.setState({ activeProfileId: 'a' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
  expect((screen.getByRole('textbox', { name: 'Bucket name' }) as HTMLInputElement).value).toBe('');
});
