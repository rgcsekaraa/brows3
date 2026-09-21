import { test, expect } from './fixtures';

for (const type of ['Upload', 'Download'] as const) {
  test(`${type} cancellation requires confirmation and Keep transferring does not cancel`, async ({ page, backend }, testInfo) => {
    const direction = type.toLowerCase();
    backend.transfers = [{ id: 'cancel-test', profile_id: 'a', bucket: 'demo-bucket', bucket_region: 'us-east-1', key: 'example.txt', local_path: '/tmp/example.txt', transfer_type: type, status: 'InProgress', total_bytes: 4096, processed_bytes: 1024, bytes_per_second: 1024, created_at: Date.now() }];
    await page.goto(`/${direction}s`);
    const button = page.getByRole('button', { name: `Cancel ${direction}`, exact: true });
    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Cancel ${direction}?`);
    await expect(dialog).toContainText('example.txt');
    expect(backend.calls.filter(call => call.command === 'cancel_transfer')).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Keep transferring' }).click();
    await expect(dialog).not.toBeVisible();
    expect(backend.transfers[0].status).toBe('InProgress');
    await button.click();
    await page.screenshot({ path: testInfo.outputPath('cancel-confirmation.png') });
    await dialog.getByRole('button', { name: `Cancel ${direction}`, exact: true }).click();
    await expect.poll(() => backend.transfers[0].status).toBe('Cancelled');
    await expect(dialog).not.toBeVisible();
    expect(backend.calls.filter(call => call.command === 'cancel_transfer')).toHaveLength(1);
  });
}
