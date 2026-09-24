import { test, expect } from './fixtures';

test('URL imports target a newly created folder without changing the existing folder workflow', async ({ page, backend }) => {
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Folder Name').fill('imports');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText('imports/', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import from URLs' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Destination: s3://demo-bucket/imports/');
  await dialog.getByLabel('Source URLs', { exact: true }).fill('https://example.com/new.txt');
  await expect(dialog.getByRole('button', { name: 'Add links', exact: true })).toHaveCSS('color', 'rgb(153, 87, 0)');
  await dialog.getByRole('button', { name: 'Add links', exact: true }).click();
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/url-import-folder.png', fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Import files', exact: true }).click();
  await expect.poll(() => backend.transfers[0]?.key).toBe('imports/new.txt');
});

test('public URL overrides are per file and never change connection defaults', async ({ page, backend }) => {
  backend.profiles[0].public_urls = { base_url: 'https://cdn.example.com/assets', include_bucket: false, bucket_overrides: {} };
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select sound.wav', exact: true }).check();
  await page.getByRole('button', { name: 'Copy public URLs', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Public URL 1')).toHaveValue('https://cdn.example.com/assets/notes.txt');
  await dialog.getByLabel('Public URL 1').fill('https://another.example.com/custom.txt');
  expect(backend.calls.filter(c => c.command === 'check_public_url')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Check access', exact: true }).first().click();
  await expect(dialog.getByText(/Anonymous HEAD request succeeded/)).toBeVisible();
  for (const width of [800, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/public-urls-${width}.png`, fullPage: true });
  }
  await dialog.getByRole('button', { name: 'Copy 2 URLs' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(backend.calls.find(c => c.command === 'plugin:clipboard-manager|write_text')?.args).toMatchObject({ text: 'https://another.example.com/custom.txt\nhttps://cdn.example.com/assets/sound.wav' });
  expect(backend.profiles[0].public_urls.base_url).toBe('https://cdn.example.com/assets');
});

test('URL import reviews paste, CSV and JSON with independent configuration before queueing', async ({ page, backend }) => {
  // This spans import, transfer cancellation, source replacement and history removal.
  // Linux WebKit needs more than the default 30s for the complete journey.
  test.setTimeout(60_000);
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import from URLs' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Source URLs', { exact: true }).fill('https://example.com/first.txt');
  await dialog.getByRole('button', { name: 'Add links', exact: true }).click();
  await dialog.getByRole('button', { name: 'Configure first.txt' }).click();
  await dialog.getByLabel('Download attempts').fill('5');
  await dialog.getByLabel('Maximum download size (GiB)').fill('1');
  await dialog.getByLabel('Source headers (JSON, optional)').fill('{"Authorization":"Bearer test-only"}');
  await dialog.getByLabel('Destination filename / path').fill('folder/first.txt');
  const fileInput = dialog.getByLabel('Import URL file');
  await fileInput.setInputFiles({ name: 'links.csv', mimeType: 'text/csv', buffer: Buffer.from('url,path\nhttps://example.com/second.txt,second.txt') });
  await expect(dialog.getByText('2 files to review')).toBeVisible();
  await fileInput.setInputFiles({ name: 'links.json', mimeType: 'application/json', buffer: Buffer.from('[{"url":"https://example.com/third.txt","path":"third.txt"}]') });
  await expect(dialog.getByText('3 files to review')).toBeVisible();
  expect(backend.calls.filter(c => c.command === 'queue_url_imports')).toHaveLength(0);
  for (const width of [800, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/url-import-${width}.png`, fullPage: true });
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep reviewing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Import files', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = backend.calls.filter(c => c.command === 'queue_url_imports');
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toMatchObject({ expectedProfileId: 'a', entries: [
    { path: 'folder/first.txt', max_attempts: 5, max_bytes: 1073741824, headers: { Authorization: 'Bearer test-only' }, replace: false },
    { path: 'second.txt', replace: false }, { path: 'third.txt', replace: false },
  ] });
  await page.goto('/uploads');
  await expect(page.getByText('Fetching source').first()).toBeVisible();
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/url-import-progress.png', fullPage: true });
  await page.getByRole('row').filter({ hasText: 'first.txt' }).getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Cancel upload?');
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/url-import-cancel.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect.poll(() => backend.transfers[0].status).toBe('Cancelled');
  await page.getByRole('button', { name: 'Edit import source' }).click();
  await expect(page.getByRole('dialog')).toContainText('Replace import source');
  await page.getByLabel('Source URLs', { exact: true }).fill('https://fresh.example.com/replacement.txt');
  await page.getByRole('button', { name: 'Add links', exact: true }).click();
  await expect(page.getByLabel('Destination filename / path')).toHaveValue('folder/first.txt');
  await expect(page.getByLabel('Destination filename / path')).toBeDisabled();
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/url-import-replace-source.png', fullPage: true });
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.filter(c => c.command === 'queue_url_imports')[1].args).toMatchObject({ entries: [{ max_bytes: 1073741824, max_attempts: 5 }] });
  await page.getByRole('button', { name: 'Remove import from list' }).click();
  await expect(page.getByRole('dialog')).toContainText('The file in S3 will not be deleted');
  await page.getByRole('button', { name: 'Remove from list', exact: true }).click();
  await expect.poll(() => backend.transfers.some(job => job.id === 'url-0')).toBe(false);
  expect(backend.calls.filter(c => c.command === 'delete_objects')).toHaveLength(0);
});

test('dark connection configuration persists and import validation prevents writes', async ({ page, backend }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('brows3-app-v2', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })));
  await page.goto('/bucket?name=demo-bucket&region=us-east-1');
  await page.getByRole('combobox').filter({ hasText: 'Development' }).click();
  await page.getByRole('option', { name: /Development/ }).getByRole('button').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Public URLs and CDN (optional)' }).click();
  await dialog.getByLabel('Public / CDN base URL').fill('https://cdn.example.com');
  await dialog.getByRole('button', { name: 'Add bucket override' }).click();
  await dialog.getByLabel('Bucket 1', { exact: true }).fill('demo-bucket');
  await dialog.getByLabel('Public root 1').fill('https://bucket.example.com/assets');
  await expect(dialog.locator('.MuiCollapse-entered')).toBeVisible();
  for (const width of [800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/url-profile-dark-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: 'Update Profile' }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.profiles[0].public_urls).toMatchObject({ base_url: 'https://cdn.example.com', bucket_overrides: { 'demo-bucket': 'https://bucket.example.com/assets' } });
  // Editing inside the connection picker leaves that picker open.
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).check();
  await page.getByRole('button', { name: 'Copy public URLs', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Public URL 1')).toHaveValue('https://bucket.example.com/assets/notes.txt');
  await dialog.getByLabel('Public URL 1').fill('https://cdn.example.com/file?token=secret');
  await expect(dialog.getByRole('button', { name: 'Copy URL', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reset to connection default' }).click();
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/public-urls-dark.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select notes.txt', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import from URLs' }).click();
  await dialog.getByLabel('Source URLs', { exact: true }).fill('https://example.com/same.txt\nhttps://other.example.com/same.txt');
  await dialog.getByRole('button', { name: 'Add links', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Import files' })).toBeDisabled();
  await expect(dialog.getByText('Duplicate destination path.', { exact: false }).first()).toBeVisible();
  if (process.env.CAPTURE_URL_UI && test.info().project.name === 'chromium') await page.screenshot({ path: '.impeccable/review/url-import-validation-dark.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Remove same.txt from import' }).last().click();
  await expect(dialog.getByRole('button', { name: 'Import files' })).toBeEnabled();
  expect(backend.calls.filter(c => c.command === 'queue_url_imports')).toHaveLength(0);
});
