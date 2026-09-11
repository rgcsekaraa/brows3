import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import PermissionsDialog from '@/components/dialogs/PermissionsDialog';
import { operationsApi } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({ operationsApi: { getObjectPermissions: vi.fn(), setObjectPermissions: vi.fn() } }));

beforeEach(() => {
  vi.mocked(operationsApi.getObjectPermissions).mockResolvedValue({ key: 'file.txt', is_folder: false, target_count: 1, status: 'available', message: null, owner_id: 'owner', owner_display_name: null, grants: [{ grantee_type: 'Group', uri: 'http://acs.amazonaws.com/groups/global/AllUsers', permission: 'READ', id: null, display_name: null, email_address: null }] });
  vi.mocked(operationsApi.setObjectPermissions).mockResolvedValue({ affected_count: 1 });
});

const props = { open: true, onClose: vi.fn(), bucketName: 'bucket', bucketRegion: 'region', objectKey: 'file.txt', isFolder: false };

async function choosePrivate() {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'New permissions' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Private' }));
}

test('existing permissions are unchanged until a replacement is explicitly selected', async () => {
  render(<PermissionsDialog {...props} />);
  await screen.findByText('READ');
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(operationsApi.setObjectPermissions).not.toHaveBeenCalled();
  await choosePrivate();
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(operationsApi.setObjectPermissions).toHaveBeenCalledExactlyOnceWith('bucket', 'region', 'file.txt', false, 'private'));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true));
});

test('changing the target clears an unsubmitted permission choice', async () => {
  const view = render(<PermissionsDialog {...props} />);
  await choosePrivate();
  view.rerender(<PermissionsDialog {...props} objectKey="other.txt" />);
  await screen.findByText('READ');
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  expect(operationsApi.setObjectPermissions).not.toHaveBeenCalled();
});
