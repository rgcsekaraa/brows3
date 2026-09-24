import { expect, test } from 'vitest';
import { parseUrlImports, validateImport, validateHttpUrl } from '@/lib/urlImport';
import { emptyPublicUrlForm, publicUrlSettings } from '@/components/profile/PublicUrlFields';

test('paste, CSV and JSON retain file-specific configuration', () => {
  expect(parseUrlImports('https://example.com/a%20b.txt\nhttps://other.example/b.csv', 'text').map(r => r.path)).toEqual(['a b.txt', 'b.csv']);
  const csv = 'url,path,replace,headers,max_attempts\r\nhttps://example.com/a,"nested/a,b.txt",true,"{""Authorization"":""Bearer fake""}",5';
  const [row] = parseUrlImports(csv, 'csv');
  expect(row).toMatchObject({ path: 'nested/a,b.txt', replace: true, headers: { Authorization: 'Bearer fake' }, max_attempts: 5 });
  expect(validateImport(row)).toBe('');
  expect(parseUrlImports(JSON.stringify([row]), 'json')).toEqual([row]);
});
test('malformed manifests fail without dropping invalid rows silently', () => {
  for (const [value, format] of [['{}','json'], ['[null]','json'], ['[{"url":"https://x.com/a","unexpected":true}]','json'], ['url,path\n"unterminated','csv'], ['url,url\na,b','csv'], ['url,replace\nhttps://example.com/a,yes','csv']] as const) expect(() => parseUrlImports(value, format)).toThrow();
  const [row] = parseUrlImports('not-a-url', 'text'); expect(validateImport(row)).toBeTruthy();
  expect(() => parseUrlImports(Array(501).fill('https://example.com/a').join('\n'), 'text')).toThrow();
});
test('unsafe headers, paths and invalid hashes are rejected', () => {
  const [entry] = parseUrlImports('https://example.com/a', 'text');
  for (const path of ['/absolute', '../file', 'a//b', 'a\\b', 'a/']) expect(validateImport({ ...entry, path })).toBeTruthy();
  const invalidHeaders: Record<string, string>[] = [{ Host: 'evil' }, { Authorization: 'x\r\ny' }, { Authorization: 'a', authorization: 'b' }];
  for (const headers of invalidHeaders) expect(validateImport({ ...entry, headers })).toBeTruthy();
  expect(validateImport({ ...entry, sha256: 'not-sha256' })).toBeTruthy();
  expect(validateImport({ ...entry, max_bytes: NaN })).toBeTruthy();
  expect(validateImport({ ...entry, max_attempts: 100 })).toBeTruthy();
  expect(validateHttpUrl('file:///tmp/a')).toBeTruthy();
});
test('public configuration preserves independent bucket roots and rejects ambiguous settings', () => {
  const form = { ...emptyPublicUrlForm(), base: 'https://cdn.example.com', overrides: [{ bucket: 'bucket', url: 'https://bucket.example.com/root' }] };
  expect(publicUrlSettings(form).bucket_overrides.bucket).toBe('https://bucket.example.com/root');
  expect(() => publicUrlSettings({ ...form, overrides: [...form.overrides, ...form.overrides] })).toThrow();
  expect(() => publicUrlSettings({ ...form, base: 'https://cdn.example.com?token=secret' })).toThrow();
});
