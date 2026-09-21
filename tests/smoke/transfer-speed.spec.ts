import { test, expect } from './fixtures';

test('transfer tables retain their layout with per-file, folder and combined speeds', async ({ page, backend }, testInfo) => {
  backend.transfers = [
    { id: 'up', profile_id: 'a', bucket: 'demo-bucket', bucket_region: 'us-east-1', key: 'upload.txt', local_path: '/tmp/upload.txt', transfer_type: 'Upload', status: 'InProgress', total_bytes: 4096, processed_bytes: 1024, bytes_per_second: 1024, created_at: Date.now() },
    { id: 'down', profile_id: 'a', bucket: 'demo-bucket', bucket_region: 'us-east-1', key: 'folder/download.txt', local_path: '/tmp/download.txt', transfer_type: 'Download', status: 'InProgress', total_bytes: 8192, processed_bytes: 2048, bytes_per_second: 2048, created_at: Date.now(), parent_group_id: 'folder', group_name: 'folder' },
  ];
  await page.goto('/uploads');
  await expect(page.getByRole('columnheader', { name: 'Speed', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1.0 KB/s', exact: true })).toBeVisible();
  await expect(page.getByText('upload.txt', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Upload: 1.0 KB/s · Download: 2.0 KB/s', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand transfers' }).click();
  await expect(page.getByText('1.0 KB/s · 25%', { exact: true })).toBeVisible();
  await expect(page.getByText('2.0 KB/s · 25%', { exact: true })).toBeVisible();
  await expect(page.locator('[data-transfer-direction=Upload] .transfer-arrow').first()).toHaveCSS('animation-name', 'transfer-upload');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-transfer-direction=Upload] .transfer-arrow').first()).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: testInfo.outputPath('uploads-desktop.png'), fullPage: true });
  await page.goto('/downloads');
  await expect(page.getByRole('cell', { name: '2.0 KB/s', exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.getByRole('columnheader', { name: 'Speed', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('downloads-narrow.png'), fullPage: true });
});
