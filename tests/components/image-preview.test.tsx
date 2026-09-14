import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ObjectPreviewDialog from '@/components/dialogs/ObjectPreviewDialog';
import { objectApi } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({
  objectApi: { getObjectMetadata: vi.fn(), getPresignedUrl: vi.fn() },
  copyToClipboard: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(objectApi.getObjectMetadata).mockResolvedValue({
    key: 'photo.png',
    size: 1024,
    content_type: 'image/png',
    e_tag: 'etag',
    last_modified: null,
    storage_class: null,
    user_metadata: {},
  });
  vi.mocked(objectApi.getPresignedUrl).mockResolvedValue('https://example.com/photo.png?sig=abc');
});

async function openImage() {
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="photo.png" />);
  return await screen.findByRole('img', { name: 'photo.png' });
}

test('renders the downloaded image scaled to fit inside the dialog', async () => {
  const img = await openImage();
  expect(img.getAttribute('src')).toBe('https://example.com/photo.png?sig=abc');

  const imgStyle = getComputedStyle(img);
  expect(imgStyle.objectFit).toBe('contain');
  expect(imgStyle.maxWidth).toBe('100%');
  expect(imgStyle.maxHeight).toBe('100%');

  // Regression guard: these ancestors must stay height-bounded (min-height: 0)
  // so a large image scales down to fit instead of growing its containers.
  let ancestor = img.parentElement;
  for (let i = 0; i < 2 && ancestor; i++) {
    expect(getComputedStyle(ancestor).minHeight).toBe('0px');
    ancestor = ancestor.parentElement;
  }
});

test('hides the loading spinner once the image finishes loading', async () => {
  const img = await openImage();
  expect(screen.getByRole('progressbar')).not.toBeNull();

  fireEvent.load(img);

  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
});
