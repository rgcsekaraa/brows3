import { test, expect } from './fixtures';

test('cross-profile paste requires confirmation and retains both profile identities', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  const selection = page.getByRole('checkbox', { name: 'Select notes.txt', exact: true });
  await selection.check();
  await selection.press('Control+c');
  await page.getByRole('combobox').filter({ hasText: 'Development' }).click();
  await page.getByRole('option', { name: /Production/ }).click();
  await expect.poll(() => backend.activeProfile).toBe('b');
  // Follow the completed profile-switch route instead of aborting its chunk load.
  await expect(page).toHaveURL(/\/$/);
  await page.getByPlaceholder('s3://bucket/prefix/').fill('s3://demo-bucket/');
  await page.getByPlaceholder('s3://bucket/prefix/').press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Select production.txt', exact: true })).toBeVisible();
  await page.locator('body').press('Control+v');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('From: Development')).toBeVisible();
  await expect(dialog.getByText('To: Production / s3://demo-bucket/')).toBeVisible();
  expect(backend.calls.filter(c => c.command === 'copy_between_profiles')).toHaveLength(0);
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_COPY_UI && test.info().project.name === 'chromium') {
      await page.screenshot({ path: `.impeccable/review/cross-copy-${width}.png`, fullPage: true });
    }
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(backend.calls.filter(c => c.command === 'copy_between_profiles')).toHaveLength(0);
  await page.locator('body').press('Control+v');
  await dialog.getByRole('button', { name: 'Copy to destination' }).click();
  await expect(dialog).toHaveCount(0);
  const calls = backend.calls.filter(c => c.command === 'copy_between_profiles');
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toMatchObject({ expectedProfileId: 'b', destinationBucket: 'demo-bucket', destinationPrefix: '', items: [{ profileId: 'a', key: 'notes.txt' }] });
  expect(backend.calls.some(c => c.command === 'copy_object' || c.command === 'move_object')).toBe(false);
});
