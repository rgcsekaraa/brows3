import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

const bucketUrl = '/bucket?name=demo-bucket&region=us-east-1';
// A deterministic calibration image makes clipping, distortion and pan easy to inspect.
const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000" viewBox="0 0 6000 4000"><rect width="6000" height="4000" fill="#344b5c"/><path d="M0 0L6000 4000M6000 0L0 4000" stroke="#b5c8cc" stroke-width="12"/><circle cx="3000" cy="2000" r="1000" fill="#b77952"/><circle cx="3000" cy="2000" r="500" fill="#dfb798"/><text x="3000" y="2050" font-family="sans-serif" font-size="160" text-anchor="middle" fill="#172631">6000 × 4000</text></svg>';

async function openImage(page: Page) {
  await page.goto(bucketUrl);
  await page.getByRole('row').filter({ hasText: 'photo.svg' }).getByTitle('Preview', { exact: true }).click();
  return page.getByRole('dialog', { name: 'photo.svg', exact: true });
}

async function imageBox(image: Locator) {
  const box = await image.boundingBox();
  if (!box) throw new Error('Missing image bounds');
  return box;
}

test.beforeEach(async ({ page, backend }) => {
  backend.objects.push({ key: 'photo.svg', size: 2048, last_modified: '2026-01-01T00:00:00Z', storage_class: 'STANDARD' });
  await page.route('https://media.brows3.test/photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: photo }));
});

test('image viewer fits huge images, offers compact controls, and refits on resize', async ({ page }, testInfo) => {
  const dialog = await openImage(page);
  const image = dialog.getByRole('img', { name: 'photo.svg' });
  await expect(dialog.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('slider')).toHaveCount(0);
  const fit = await imageBox(image);
  expect(fit.width / fit.height).toBeCloseTo(1.5, 2);
  expect(fit.width / 6000).toBeLessThan(.25);
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await imageBox(image)).width / fit.width).toBeCloseTo(1.4, 2);
  await dialog.getByRole('button', { name: 'Fit to screen', exact: true }).click();
  const stage = dialog.getByRole('region', { name: 'Image viewport' });
  await stage.focus();
  await page.screenshot({ path: testInfo.outputPath('viewer-desktop.png') });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(async () => (await imageBox(image)).width).toBeLessThan(350);
  const narrow = await imageBox(image);
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.width / narrow.height).toBeCloseTo(1.5, 2);
  const controls = await imageBox(dialog.getByRole('group', { name: 'Image zoom controls' }));
  expect(controls.x).toBeGreaterThanOrEqual(0);
  expect(controls.x + controls.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('viewer-narrow.png') });
  await dialog.getByRole('button', { name: 'Actual size', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(dialog.getByLabel('Zoom level')).toHaveText('100%');
  expect((await imageBox(image)).width).toBeCloseTo(6000, 0);
});

test('image viewer supports actual size, keyboard pan, drag, wheel, double-click and focus restoration', async ({ page }) => {
  const dialog = await openImage(page);
  const image = dialog.getByRole('img', { name: 'photo.svg' });
  const stage = dialog.getByRole('region', { name: 'Image viewport' });
  await dialog.getByRole('button', { name: 'Actual size', exact: true }).click();
  await expect(dialog.getByLabel('Zoom level')).toHaveText('100%');
  expect((await imageBox(image)).width).toBeCloseTo(6000, 0);
  const original = await imageBox(image);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  expect((await imageBox(image)).x).toBeCloseTo(original.x - 40, 0);
  const area = await imageBox(stage);
  const x = area.x + area.width / 2, y = area.y + area.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 100, y - 80); await page.mouse.up();
  expect((await imageBox(image)).x).toBeCloseTo(original.x - 140, 0);
  await page.mouse.wheel(0, -150);
  await expect.poll(async () => (await imageBox(image)).width).toBeGreaterThan(6000);
  await page.mouse.dblclick(x, y);
  await expect(dialog.getByRole('button', { name: 'Fit to screen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const fitted = await imageBox(image);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 100, y - 80); await page.mouse.up();
  expect((await imageBox(image)).x).toBeCloseTo(fitted.x, 0);
  await page.keyboard.press('+');
  await expect.poll(async () => (await imageBox(image)).width).toBeGreaterThan(fitted.width);
  await page.keyboard.press('0');
  await expect(dialog.getByRole('button', { name: 'Fit to screen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'photo.svg' }).getByTitle('Preview', { exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Fit to screen', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('failed images stop loading and retry requests a fresh signed URL', async ({ page, backend }) => {
  let failed = true;
  await page.route('https://media.brows3.test/photo.svg', route => failed ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: photo }));
  const dialog = await openImage(page);
  await expect(dialog.getByRole('alert')).toContainText('Could not load this image');
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  const before = backend.calls.filter(call => call.command === 'get_presigned_url').length;
  failed = false;
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  expect(backend.calls.filter(call => call.command === 'get_presigned_url').length).toBeGreaterThan(before);
  await dialog.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'photo.svg' }).getByTitle('Preview', { exact: true })).toBeFocused();
});

test('stalled image requests time out with a retry action', async ({ page }) => {
  await page.clock.install();
  await page.route('https://media.brows3.test/photo.svg', () => {});
  const dialog = await openImage(page);
  await expect(dialog.getByRole('img', { name: 'photo.svg', includeHidden: true })).toHaveAttribute('src', 'https://media.brows3.test/photo.svg');
  await page.clock.fastForward(31000);
  await expect(dialog.getByRole('alert')).toContainText('took too long to load');
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('bottom controls stay synchronized without animation frames and support keyboard shortcuts', async ({ page }) => {
  const dialog = await openImage(page);
  const image = dialog.getByRole('img', { name: 'photo.svg' });
  const zoomOut = dialog.getByRole('button', { name: 'Zoom out', exact: true });
  const fit = dialog.getByRole('button', { name: 'Fit to screen', exact: true });
  const actual = dialog.getByRole('button', { name: 'Actual size', exact: true });
  await expect(zoomOut).toBeEnabled();
  const initial = await imageBox(image);
  await zoomOut.click();
  await expect.poll(async () => (await imageBox(image)).width).toBeLessThan(initial.width);
  await expect(fit).toHaveAttribute('aria-pressed', 'false');
  await zoomOut.press('1');
  await expect(actual).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Zoom level')).toHaveText('100%');
  await actual.press('0');
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    Object.assign(window, { __restoreViewerRaf: () => { window.requestAnimationFrame = original; } });
    window.requestAnimationFrame = () => 0;
    (document.querySelector('[aria-label="Actual size"]') as HTMLButtonElement).click();
  });
  try {
    await expect(dialog.getByLabel('Zoom level')).toHaveText('100%');
    await fit.evaluate(button => (button as HTMLButtonElement).click());
    await expect(dialog.getByLabel('Zoom level')).not.toHaveText('100%');
    await expect(fit).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await page.evaluate(() => (window as unknown as { __restoreViewerRaf: () => void }).__restoreViewerRaf());
  }
});

test('viewer controls follow the app light and dark themes', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const dialog = await openImage(page);
  const controls = dialog.getByRole('group', { name: 'Image zoom controls' });
  await expect(controls).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('controls-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(controls).toHaveCSS('background-color', 'rgb(17, 24, 39)');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.screenshot({ path: testInfo.outputPath('controls-dark-narrow.png') });
});

test('image sequence follows listing order and supports buttons and keyboard without losing focus', async ({ page, backend }, testInfo) => {
  for (const key of ['alpha.svg', 'beta.svg']) {
    backend.objects.push({ key, size: 1024, last_modified: null, storage_class: 'STANDARD' });
    await page.route(`https://media.brows3.test/${key}`, route => route.fulfill({ contentType: 'image/svg+xml', body: photo }));
  }
  await openImage(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Image position')).toHaveText('3 / 3');
  await expect(dialog.getByRole('button', { name: 'Next image', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Previous image', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('beta.svg');
  await expect(dialog.getByRole('img', { name: 'beta.svg' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog).toHaveAccessibleName('alpha.svg');
  await expect(dialog.getByRole('button', { name: 'Previous image', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Actual size', exact: true }).click();
  const image = dialog.getByRole('img', { name: 'alpha.svg' });
  const original = await imageBox(image);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await imageBox(image)).x).toBeCloseTo(original.x - 120, 0);
  await expect(dialog).toHaveAccessibleName('alpha.svg');
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toHaveAccessibleName('beta.svg');
  await expect(dialog.getByRole('button', { name: 'Fit to screen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('sequence-controls.png') });
  await dialog.getByRole('button', { name: 'Next image', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('photo.svg');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row').filter({ hasText: 'photo.svg' }).getByTitle('Preview', { exact: true })).toBeFocused();
});

test('single-image controls are compact, round, and omit unavailable navigation', async ({ page }) => {
  const dialog = await openImage(page);
  const controls = dialog.getByRole('group', { name: 'Image zoom controls' });
  await expect(controls).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next image', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Previous image', exact: true })).toHaveCount(0);
  await expect(controls).toHaveCSS('border-radius', '999px');
  await expect(controls.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCSS('width', '32px');
  await expect(controls.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCSS('border-radius', '50%');
  expect(await dialog.innerText()).not.toMatch(/[\u2013\u2014]/);
});

test('pinch zoom and pointer cancellation do not leave a stuck drag', async ({ page }) => {
  const dialog = await openImage(page);
  const stage = dialog.getByRole('region', { name: 'Image viewport' });
  const image = dialog.getByRole('img', { name: 'photo.svg' });
  await expect(dialog.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  const initial = await imageBox(image);
  // Dispatch touch pointers while stubbing only capture, which synthetic pointers cannot own.
  await stage.evaluate(element => {
    element.setPointerCapture = () => {};
    element.hasPointerCapture = () => false;
    const send = (type: string, pointerId: number, x: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', clientX: x, clientY: 200, button: 0 }));
    send('pointerdown', 1, 200); send('pointerdown', 2, 300);
    send('pointermove', 2, 400);
    send('pointercancel', 1, 200); send('pointercancel', 2, 400);
  });
  await expect.poll(async () => (await imageBox(image)).width / initial.width).toBeCloseTo(2, 2);
  const after = await imageBox(image);
  await stage.dispatchEvent('pointermove', { pointerId: 2, clientX: 800, clientY: 400 });
  expect((await imageBox(image)).x).toBeCloseTo(after.x, 0);
});
