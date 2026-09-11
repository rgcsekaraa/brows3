import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ObjectPreviewDialog from '@/components/dialogs/ObjectPreviewDialog';
import { objectApi } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({ objectApi: { getObjectMetadata: vi.fn(), getObjectContent: vi.fn(), putObjectContent: vi.fn() }, copyToClipboard: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({ default: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { readOnly: boolean } }) => <textarea aria-label="File content" value={value} readOnly={options.readOnly} onChange={event => onChange(event.target.value)} /> }));

beforeEach(() => {
  vi.mocked(objectApi.getObjectMetadata).mockResolvedValue({ key: 'file.txt', size: 3, content_type: 'text/plain', e_tag: 'head-etag', last_modified: null, storage_class: null, user_metadata: {} });
  vi.mocked(objectApi.getObjectContent).mockResolvedValue({ content: 'old', e_tag: 'body-etag', profile_id: 'profile-a' });
  vi.mocked(objectApi.putObjectContent).mockResolvedValue('saved-etag');
});

async function openEditor() {
  render(<ObjectPreviewDialog open onClose={vi.fn()} bucketName="bucket" bucketRegion="region" objectKey="file.txt" startInEditMode />);
  return await screen.findByRole('textbox', { name: 'File content' });
}

test('saves use the body ETag and update it for the next edit', async () => {
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'first edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(objectApi.putObjectContent).toHaveBeenCalledWith('bucket', 'region', 'file.txt', 'first edit', 'body-etag', 'profile-a'));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.change(editor, { target: { value: 'second edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(objectApi.putObjectContent).toHaveBeenLastCalledWith('bucket', 'region', 'file.txt', 'second edit', 'saved-etag', 'profile-a'));
});

test('failed saves leave the unsaved text visible and available to copy', async () => {
  vi.mocked(objectApi.putObjectContent).mockRejectedValueOnce('This object has changed since it was opened.');
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'my unsaved edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await screen.findByText('This object has changed since it was opened.');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my unsaved edit');
});

test('missing ETags allow viewing but prevent saving', async () => {
  vi.mocked(objectApi.getObjectContent).mockResolvedValueOnce({ content: 'old', e_tag: null, profile_id: 'profile-a' });
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'edit' } });
  expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true);
  expect(objectApi.putObjectContent).not.toHaveBeenCalled();
});
