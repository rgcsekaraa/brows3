import { test, expect } from './fixtures';

for (const type of ['Upload', 'Download'] as const) {
  test(`${type} table fits the viewport with long names and expanded folders`, async ({ page, backend }, testInfo) => {
    backend.transfers = [{ id: 'layout', profile_id: 'a', bucket: 'demo-bucket', bucket_region: 'us-east-1', key: `${'long-file-name-'.repeat(12)}.zip`, local_path: '/tmp/file', transfer_type: type, status: 'InProgress', total_bytes: 1024 ** 4, processed_bytes: 1024 ** 3, bytes_per_second: 123456789, created_at: Date.now(), parent_group_id: 'folder', group_name: 'folder-with-a-very-long-name-without-any-spaces-at-all' }];
    await page.goto(`/${type.toLowerCase()}s`);
    await page.getByRole('button', { name: 'expand row' }).click();
    for (const width of [1440, 1100, 901, 800]) {
      await page.setViewportSize({ width, height: 900 });
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText(['File', 'Status', 'Size', 'Progress', 'Speed', 'Started', 'Finished', 'Elapsed', 'Actions']);
      await expect(table.getByRole('rowheader').first()).toContainText('folder-with-a-very-long-name');
      await expect(table.getByRole('rowheader').nth(1)).toContainText('long-file-name-');
      await expect.poll(() => table.evaluate(element => {
        const container = element.parentElement!;
        return container.scrollWidth - container.clientWidth;
      })).toBeLessThanOrEqual(1);
      const bounds = await table.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await expect(page.getByRole('button', { name: `Cancel ${type.toLowerCase()}`, exact: true })).toBeInViewport();
      await expect(table.getByRole('columnheader', { name: 'Speed', exact: true })).toBeInViewport();
      if (width === 1440 || width === 901) await page.screenshot({ path: testInfo.outputPath(`${type}-${width}.png`), fullPage: true });
    }
  });
}
