import { test, expect } from './fixtures';

test('bandwidth validates units and applies only an explicit valid value', async ({ page, backend }) => {
  await page.goto('/settings');
  const input = page.getByRole('textbox', { name: 'Limit (KiB/s)' });
  await input.fill('1');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await input.fill('512');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Bandwidth limit saved', { exact: true })).toBeVisible();
  expect(backend.calls.some(c => c.command === 'set_transfer_bandwidth' && c.args.bytesPerSecond === 524288)).toBe(true);
  await expect(page.getByText(/this is not a total app limit/)).toBeVisible();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await input.scrollIntoViewIfNeeded();
    if (process.env.CAPTURE_CONTROLS_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/bandwidth-${width}.png` });
  }
  await page.reload();
  await expect(input).toHaveValue('512');
});

test('filter and conflict choices require a fresh sync preview', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sync local folder...' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByLabel('Include patterns').fill('**/*.txt');
  await page.getByLabel('Exclude patterns').fill('cache/**');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('table', { name: 'Sync preview' })).toBeVisible();
  expect(backend.calls.findLast(c => c.command === 'preview_folder_sync')?.args.options).toEqual({ include: ['**/*.txt'], exclude: ['cache/**'], skip_existing: false });
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_CONTROLS_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/controls-${width}.png` });
  }
  await page.getByRole('checkbox', { name: 'Confirm replacement of existing objects' }).check();
  await page.getByRole('combobox', { name: 'Existing objects' }).click();
  await page.getByRole('option', { name: 'Skip all existing objects' }).click();
  await expect(page.getByRole('table', { name: 'Sync preview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start sync' })).toBeDisabled();
  expect(backend.calls.filter(c => c.command === 'start_folder_sync')).toHaveLength(0);
});
