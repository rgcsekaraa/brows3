import { test, expect } from './fixtures';
const bucket = '/bucket?name=demo-bucket&region=us-east-1';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#344b5c"/><circle cx="300" cy="200" r="100" fill="#dfb798"/></svg>';
test.beforeEach(async ({ page, backend }) => {
  backend.objects = ['a.svg', 'b.txt', 'c.zip', 'z.svg'].map(key => ({ key, size: 100, last_modified: null, storage_class: 'STANDARD' }));
  await page.route('https://media.brows3.test/*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
});

test('selection follows mixed previews and remains in the table after closing', async ({ page }) => {
  await page.goto(bucket);
  await page.getByRole('row').filter({ hasText: 'a.svg' }).getByTitle('Preview', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'a.svg' })).toBeVisible();
  await page.getByRole('button', { name: 'Select file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select file', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/preview-selection-${width}.png` });
  }
  await page.getByRole('button', { name: 'Next file', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('b.txt');
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select file', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Select file', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('img', { name: 'z.svg' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next file', exact: true })).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Select file', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Select file', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'a.svg' }).getByTitle('Preview', { exact: true })).toBeFocused();
});

test('editing disables navigation and closing requires explicit discard approval', async ({ page, backend }) => {
  await page.goto(bucket);
  await page.getByRole('row').filter({ hasText: 'b.txt' }).getByTitle('Edit', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('unsaved text');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('unsaved text');
  await expect(page.getByRole('button', { name: 'Next file', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog')).toContainText('b.txt');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('unsaved text');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.filter(call => call.command === 'put_object_content')).toHaveLength(0);
});

test('dark mixed-preview controls stay compact and match table size sorting', async ({ page, backend }) => {
  backend.objects[0].size = 200;
  await page.addInitScript(() => localStorage.setItem('brows3-app-v2', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })));
  await page.goto(bucket);
  await page.getByRole('columnheader', { name: 'Size', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'b.txt' }).getByTitle('Preview', { exact: true }).click();
  await expect(page.getByLabel('Preview position')).toHaveText('2 / 3');
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await page.getByRole('button', { name: 'Select file', exact: true }).click();
  for (const width of [1440, 800]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (test.info().project.name === 'chromium') await page.screenshot({ path: `.impeccable/review/preview-text-dark-${width}.png` });
  }
  await expect(page.getByRole('button', { name: 'Select file', exact: true })).toHaveCSS('border-radius', '999px');
});

test('discarding edits resets the baseline when editing is reopened', async ({ page, backend }) => {
  await page.goto(bucket);
  await page.getByRole('row').filter({ hasText: 'b.txt' }).getByTitle('Edit', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('discard this draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('original text');
  await page.getByRole('button', { name: 'Edit File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.filter(call => call.command === 'put_object_content')).toHaveLength(0);
});
