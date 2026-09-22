import { test, expect } from './fixtures';

test('version history recovers a deleted exact key only after approval', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Exact object key').fill('deleted/photo.png');
  await dialog.getByRole('button', { name: 'Load history' }).click();
  await expect(dialog.getByRole('table', { name: 'Object versions' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Select version current-delete-marker' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Select version older-data-version-with-a-long-identifier-0123456789' }).click();
  await expect(dialog.getByRole('button', { name: 'Restore selected version' })).toBeDisabled();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_VERSIONS_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/versions-${width}.png`, fullPage: true });
  }
  expect(backend.calls.some(c => c.command === 'restore_object_version')).toBe(false);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Restore selected version' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.calls.find(c => c.command === 'restore_object_version')?.args).toMatchObject({ key: 'deleted/photo.png', expectedProfileId: 'a', confirmed: true, expectedCurrentVersion: 'current-delete-marker' });
});

test('closing history leaves the object and its versions unchanged', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).check();
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Exact object key')).toHaveValue('notes.txt');
  await expect(dialog.getByRole('table')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(backend.calls.some(c => ['restore_object_version', 'delete_objects', 'put_object_content'].includes(c.command))).toBe(false);
});
