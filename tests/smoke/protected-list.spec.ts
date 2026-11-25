import { test, expect } from './fixtures';

test('paginated encrypted listings virtualize rows and download through the protected command', async ({ page, backend }) => {
  const bucket = 'b3e1-' + 'a'.repeat(32);
  backend.buckets = [bucket];
  const token = 'test-session-token';
  const invoke = backend.invoke.bind(backend);
  backend.invoke = async (command, args = {}) => {
    if (command === 'unlock_encrypted_bucket') {
      return { sessionToken: token, label: 'Private files', expiresAtMs: Date.now() + 900_000 };
    }
    if (command === 'list_objects' && args.sessionToken === token) {
      const secondPage = !!args.continuationToken;
      const count = secondPage ? 120 : 1;
      return {
        objects: Array.from({ length: count }, (_, i) => ({
          key: `file-${String(i + (secondPage ? 1 : 0)).padStart(3, '0')}.txt`,
          size: 20, last_modified: '', storage_class: 'STANDARD',
        })),
        common_prefixes: secondPage ? [] : ['.brows3/', 'folder/'],
        next_continuation_token: secondPage ? null : 'second', is_truncated: !secondPage,
        prefix: '', bucket_region: 'us-east-1',
      };
    }
    if (command === 'download_encrypted_file' || command === 'lock_encrypted_bucket') {
      backend.calls.push({ command, args });
      return null;
    }
    return invoke(command, args);
  };

  await page.goto('/');
  const path = page.getByPlaceholder('s3://bucket/prefix/');
  await path.fill(`s3://${bucket}/`);
  await path.press('Enter');
  await page.getByLabel('Bucket passphrase').fill('test passphrase for this bucket');
  await page.getByRole('button', { name: 'Unlock bucket' }).click();
  await expect(page.getByRole('button', { name: 'Download file-000.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more' }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('button', { name: 'Open folder/' })).toBeVisible();
  await expect(table.getByRole('checkbox')).toHaveCount(0);
  await expect(table.getByText('.brows3/')).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Download file-120.txt' })).toHaveCount(0);
  await table.locator('xpath=ancestor::*[@data-virtuoso-scroller][1]').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await table.getByRole('button', { name: 'Download file-120.txt' }).click();
  await expect.poll(() => backend.calls.filter(call => call.command === 'download_encrypted_file')).toHaveLength(1);
  expect(backend.calls.find(call => call.command === 'download_encrypted_file')?.args).toMatchObject({
    key: 'file-120.txt', bucketName: bucket, sessionToken: token,
  });
  expect(backend.calls.some(call => call.command === 'queue_download')).toBe(false);
});
