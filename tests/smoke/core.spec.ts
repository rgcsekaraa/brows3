import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const bucketUrl = '/bucket?name=demo-bucket&region=us-east-1';

async function editText(page: Page, value: string) {
  await page.evaluate(text => {
    const monaco = (window as unknown as { monaco: { editor: { getModels: () => { setValue: (value: string) => void }[] } } }).monaco;
    const models = monaco.editor.getModels();
    if (models.length !== 1) throw new Error(`Expected one open editor, found ${models.length}`);
    models[0].setValue(text);
  }, value);
}

test('direct S3 navigation opens a folder and settings remain reachable at narrow widths', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('s3://bucket/prefix/').fill('s3://demo-bucket/nested/');
  await page.getByPlaceholder('s3://bucket/prefix/').press('Enter');
  await expect(page).toHaveURL(/prefix=nested%2F/);
  await expect(page.getByRole('checkbox', { name: 'Select nested/match.txt', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByText('Settings', { exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.setViewportSize({ width: 901, height: 800 });
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveCount(0);
  await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
});

test('deep search selection is cleared when changing profiles', async ({ page, backend }) => {
  await page.goto(bucketUrl);
  await page.getByPlaceholder('Search current folder...').fill('match');
  await page.getByRole('checkbox', { name: 'Deep search' }).check();
  const result = page.getByRole('checkbox', { name: 'Select nested/match.txt', exact: true });
  await result.check();
  await result.press('Control+c');
  await expect(page.getByText('Copied 1 items', { exact: true })).toBeVisible();
  await result.check();
  await page.getByRole('combobox').filter({ hasText: 'Development' }).click();
  await page.getByRole('option', { name: /Production/ }).click();
  await expect.poll(() => backend.activeProfile).toBe('b');
  await expect(result).toHaveCount(0);
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('brows3-clipboard') || '{}').state.items)).toEqual([]);
});

test('copy and paste through a selected row retain the source profile', async ({ page, backend }) => {
  await page.goto(bucketUrl);
  const selection = page.getByRole('checkbox', { name: 'Select notes.txt', exact: true });
  await selection.check();
  await selection.press('Control+c');
  await page.getByText('nested/', { exact: true }).dblclick();
  await page.locator('body').press('Control+v');
  await expect.poll(() => backend.calls.find(call => call.command === 'copy_object')?.args).toMatchObject({ sourceKey: 'notes.txt', destinationKey: 'nested/notes.txt', expectedProfileId: 'a' });
  await expect(page.getByRole('checkbox', { name: 'Select nested/notes.txt', exact: true })).toBeVisible();
});

test('the real editor saves conditionally and keeps text visible after a conflict', async ({ page, backend }) => {
  backend.contentType = 'application/json';
  await page.goto(bucketUrl);
  await page.getByRole('row').filter({ hasText: 'notes.txt' }).getByTitle('Edit', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  await editText(page, 'first edit');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => backend.content).toBe('first edit');
  expect(backend.calls.find(call => call.command === 'put_object_content')?.args).toMatchObject({ expectedEtag: '"v1"', expectedProfileId: 'a' });
  backend.conflict = true;
  await editText(page, 'unsaved edit');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('This object has changed since it was opened.', { exact: true })).toBeVisible();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('unsaved edit');
  expect(backend.content).toBe('first edit');
});

test('downloads can be queued, cancelled and retried through the transfer page', async ({ page, backend }) => {
  await page.goto(bucketUrl);
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).check();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => backend.transfers.length).toBe(1);
  await page.getByText('Downloads', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/downloads/);
  await page.getByLabel('Cancel', { exact: true }).getByRole('button').click();
  await expect.poll(() => backend.transfers[0].status).toBe('Cancelled');
  await page.getByLabel('Retry', { exact: true }).getByRole('button').click();
  await expect.poll(() => backend.transfers.length).toBe(2);
  expect(backend.transfers[0]).toMatchObject({ profile_id: 'a', key: 'notes.txt', status: 'Pending' });
});

test('audio previews load under the packaged content security policy', async ({ page }) => {
  const samples = Buffer.alloc(1600);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + samples.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(samples.length, 40);
  await page.route('https://media.brows3.test/sound.wav', route => route.fulfill({ contentType: 'audio/wav', body: Buffer.concat([header, samples]) }));
  await page.goto(bucketUrl);
  await page.getByRole('row').filter({ hasText: 'sound.wav' }).getByTitle('Preview', { exact: true }).click();
  await expect(page.locator('audio')).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
});

test('a large image preview scales down to fit inside the dialog', async ({ page, backend }) => {
  backend.objects.push({ key: 'photo.svg', size: 2048, last_modified: '2026-01-01T00:00:00Z', storage_class: 'STANDARD' });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000"><rect width="100%" height="100%" fill="red"/></svg>';
  await page.route('https://media.brows3.test/photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.goto(bucketUrl);
  await page.getByRole('row').filter({ hasText: 'photo.svg' }).getByTitle('Preview', { exact: true }).click();

  const image = page.getByRole('dialog').getByRole('img', { name: 'photo.svg' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(6000);

  const dialogBox = await page.getByRole('dialog').boundingBox();
  const imageBox = await image.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  // The image keeps its 3:2 intrinsic ratio but must be scaled far below its
  // native 6000x4000 size to fit inside the dialog, not overflow it.
  expect(imageBox!.width).toBeLessThanOrEqual(dialogBox!.width);
  expect(imageBox!.height).toBeLessThanOrEqual(dialogBox!.height);
  expect(imageBox!.width).toBeLessThan(1000);
});

test('uploads use the current folder and appear on the upload page', async ({ page, backend }) => {
  await page.goto(`${bucketUrl}&prefix=nested%2F`);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Files', exact: true }).click();
  await expect.poll(() => backend.transfers.length).toBe(1);
  expect(backend.transfers[0]).toMatchObject({ transfer_type: 'Upload', profile_id: 'a', key: 'nested/upload.txt', status: 'Pending' });
  await page.getByText('Uploads', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/uploads/);
  await expect(page.getByRole('row').filter({ hasText: 'upload.txt' })).toBeVisible();
});

test('deletion requires confirmation and refreshes the listing afterwards', async ({ page, backend }) => {
  await page.goto(bucketUrl);
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Confirmation' });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(backend.calls.filter(call => call.command === 'delete_objects')).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => backend.calls.find(call => call.command === 'delete_objects')?.args.keys).toEqual(['notes.txt']);
  await expect(page.getByRole('checkbox', { name: 'Select notes.txt', exact: true })).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
});

test('bucket favorites reopen the root and can be removed from the sidebar', async ({ page }) => {
  await page.goto(`${bucketUrl}&prefix=nested%2F`);
  await page.getByRole('button', { name: 'Add bucket root to Favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove bucket root from Favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Favorites', { exact: true }).first().click();
  await page.getByRole('main').getByText('demo-bucket', { exact: true }).click();
  await expect(page).toHaveURL(/name=demo-bucket&region=us-east-1$/);
  await page.getByRole('button', { name: 'Remove demo-bucket from Favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add bucket root to Favorites', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('empty truncated listings remain pageable until objects arrive', async ({ page, backend }) => {
  backend.emptyListingPages = 2;
  await page.goto(bucketUrl);
  await expect(page.getByText('Empty folder', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect.poll(() => backend.emptyListingPages).toBe(0);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select notes.txt', exact: true })).toBeVisible();
  expect(backend.calls.filter(call => call.command === 'list_objects').map(call => call.args.continuationToken)).toEqual([null, 'page-1', 'page-0']);
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
});

for (const transferType of ['Upload', 'Download'] as const) {
  test(`${transferType} failures show the provider message without hovering`, async ({ page, backend }) => {
    backend.transfers = [{ id: 'failed', profile_id: 'a', transfer_type: transferType, bucket: 'demo-bucket', bucket_region: 'us-east-1', key: 'failed.txt', local_path: '/virtual/failed.txt', total_bytes: 4, processed_bytes: 0, status: { Failed: 'AccessDenied: This key cannot write objects' }, created_at: Date.now() }];
    await page.goto(transferType === 'Upload' ? '/uploads' : '/downloads');
    await expect(page.getByRole('main').getByText('AccessDenied: This key cannot write objects', { exact: true })).toBeVisible();
  });
}

test('buckets can be created and deleted with explicit confirmation', async ({ page, backend }) => {
  await page.goto('/?view=discovery');
  await page.getByRole('button', { name: 'Create bucket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bucket name', exact: true }).fill('new-bucket');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('table', { name: 'buckets table' }).getByText('new-bucket', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add new-bucket to Favorites', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage new-bucket', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete bucket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete bucket' });
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Type the bucket name to confirm' }).fill('new-bucket');
  backend.deleteBucketError = 'BucketNotEmpty: Remove objects and versions first';
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'BucketNotEmpty' })).toBeVisible();
  expect(backend.buckets).toContain('new-bucket');
  backend.deleteBucketError = '';
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage new-bucket', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add new-bucket to Favorites', exact: true })).toHaveCount(0);
});

test('bucket policies can be edited while failed saves retain the draft', async ({ page, backend }) => {
  backend.bucketPolicy = '{"Statement":[]}';
  await page.goto('/?view=discovery');
  await page.getByRole('button', { name: 'Manage demo-bucket', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit bucket policy', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bucket policy' });
  await expect(dialog.getByRole('textbox', { name: 'Policy JSON' })).toHaveValue(backend.bucketPolicy);
  await dialog.getByRole('textbox', { name: 'Policy JSON' }).fill('{"Version":"2012-10-17","Statement":[]}');
  await dialog.getByRole('textbox', { name: 'Type the bucket name to confirm' }).fill('demo-bucket');
  backend.bucketPolicy = '{}';
  await dialog.getByRole('button', { name: 'Save policy' }).click();
  await expect(dialog.getByRole('alert')).toContainText('policy or profile changed');
  await expect(dialog.getByRole('textbox', { name: 'Policy JSON' })).toHaveValue('{"Version":"2012-10-17","Statement":[]}');
  backend.bucketPolicy = '{"Statement":[]}';
  await dialog.getByRole('button', { name: 'Save policy' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.bucketPolicy).toBe('{"Version":"2012-10-17","Statement":[]}');
});

test('bucket drafts are cleared when reopened under another profile', async ({ page, backend }) => {
  await page.goto('/?view=discovery');
  await page.getByRole('button', { name: 'Create bucket', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bucket name', exact: true }).fill('unsaved-bucket');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('combobox').filter({ hasText: 'Development' }).click();
  await page.getByRole('option', { name: /Production/ }).click();
  await page.getByRole('button', { name: 'List All Buckets', exact: true }).click();
  await page.getByRole('button', { name: 'Create bucket', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Bucket name', exact: true })).toHaveValue('');
  expect(backend.calls.filter(call => call.command === 'create_bucket')).toHaveLength(0);
});
