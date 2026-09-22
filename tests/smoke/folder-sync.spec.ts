import { test, expect } from './fixtures';

test('folder sync previews safely and requires explicit replacement approval', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sync local folder...' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('table', { name: 'Sync preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start sync' })).toBeDisabled();
  expect(backend.calls.filter(c => c.command === 'start_folder_sync')).toHaveLength(0);
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/sync-${width}.png` });
  }
  await page.getByRole('checkbox', { name: 'Confirm replacement of existing objects' }).check();
  await page.getByRole('button', { name: 'Start sync' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.find(c => c.command === 'start_folder_sync')?.args).toMatchObject({ planId: 'sync-plan', replaceExisting: true, expectedProfileId: 'a' });
});

test('closing a sync preview does not enqueue uploads', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sync local folder...' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('table', { name: 'Sync preview' })).toBeVisible();
  // WebKit can move focus to BODY when Preview is disabled during the request.
  // MUI restores that focus asynchronously; keyboard input must target the modal.
  await expect.poll(() => page.getByRole('dialog').evaluate(el =>
    el.closest('.MuiModal-root')?.contains(document.activeElement) ?? false
  )).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.filter(c => c.command === 'start_folder_sync')).toHaveLength(0);
});
