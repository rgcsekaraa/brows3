import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ObjectPreviewDialog from '@/components/dialogs/ObjectPreviewDialog';
import { objectApi } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({
  objectApi: { getObjectMetadata: vi.fn(), getObjectContent: vi.fn(), putObjectContent: vi.fn() },
  copyToClipboard: vi.fn(),
}));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { readOnly: boolean } }) =>
    <textarea aria-label="File content" value={value} readOnly={options.readOnly} onChange={event => onChange(event.target.value)} />,
}));

beforeEach(() => {
  vi.mocked(objectApi.getObjectMetadata).mockResolvedValue({ key: 'file.txt', size: 3, content_type: 'text/plain', e_tag: 'etag', last_modified: null, storage_class: null, user_metadata: {} });
  vi.mocked(objectApi.getObjectContent).mockResolvedValue({ content: 'hello', e_tag: 'etag', profile_id: 'profile-a' });
});

test('arrow buttons render and call onNavigate when there is more than one item', async () => {
  const onNavigate = vi.fn();
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="file.txt" onNavigate={onNavigate} canNavigate />);
  await screen.findByRole('textbox', { name: 'File content' });

  fireEvent.click(screen.getByRole('button', { name: 'Previous item' }));
  expect(onNavigate).toHaveBeenCalledWith('prev');

  fireEvent.click(screen.getByRole('button', { name: 'Next item' }));
  expect(onNavigate).toHaveBeenCalledWith('next');
});

test('arrow keys navigate while the dialog is open', async () => {
  const onNavigate = vi.fn();
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="file.txt" onNavigate={onNavigate} canNavigate />);
  await screen.findByRole('textbox', { name: 'File content' });

  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onNavigate).toHaveBeenCalledWith('next');

  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(onNavigate).toHaveBeenCalledWith('prev');
});

test('no navigation arrows or keyboard handling when there is only one item', async () => {
  const onNavigate = vi.fn();
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="file.txt" onNavigate={onNavigate} canNavigate={false} />);
  await screen.findByRole('textbox', { name: 'File content' });

  expect(screen.queryByRole('button', { name: 'Previous item' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next item' })).toBeNull();

  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onNavigate).not.toHaveBeenCalled();
});

test('arrow keys do not hijack editing while the text editor is active', async () => {
  const onNavigate = vi.fn();
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="file.txt" onNavigate={onNavigate} canNavigate startInEditMode />);
  const editor = await screen.findByRole('textbox', { name: 'File content' });

  fireEvent.keyDown(editor, { key: 'ArrowRight' });
  await waitFor(() => expect(onNavigate).not.toHaveBeenCalled());
});
