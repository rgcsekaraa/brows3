import { expect, test } from 'vitest';
import { canObjectBeEdited, canObjectBePreviewed, getEditorLanguage, getObjectExtension, getObjectKind, getObjectName } from '@/lib/objectCapabilities';

test.each([
  ['report.bin', 'application/problem+json; charset=utf-8', 'text', true],
  ['data', 'APPLICATION/JSON', 'text', true],
  ['photo.txt', 'image/png', 'image', false],
  ['recording', 'audio/wav', 'audio', false],
  ['clip', 'video/mp4', 'video', false],
  ['document', 'application/pdf', 'pdf', false],
  ['archive.ZIP', null, 'binary', false],
  ['font.woff2', 'application/octet-stream', 'binary', false],
  ['.env', null, 'text', true],
  ['README', 'application/octet-stream', 'text', true],
  ['photo.PNG', null, 'image', false],
  ['sound.MP3', null, 'audio', false],
] as const)('preview and edit actions match %s with content type %s', (name, contentType, kind, editable) => {
  expect(getObjectKind(name, contentType)).toBe(kind);
  expect(canObjectBeEdited(name, contentType)).toBe(editable);
  expect(canObjectBePreviewed(name, contentType)).toBe(kind !== 'binary');
});

test.each([
  ['data.txt', 'application/problem+json', 'json'],
  ['settings', 'application/yaml; charset=utf-8', 'yaml'],
  ['main.TS', null, 'typescript'],
  ['infra.tf', null, 'hcl'],
  ['Cargo.toml', null, 'ini'],
  ['README', null, 'plaintext'],
] as const)('editor language follows content metadata or filename for %s', (name, contentType, language) => {
  expect(getEditorLanguage(name, contentType)).toBe(language);
});

test('object names retain spaces and Unicode without treating dotfiles as extensions', () => {
  expect(getObjectName('nested/東京 report.JSON')).toBe('東京 report.JSON');
  expect(getObjectExtension('東京 report.JSON')).toBe('json');
  expect(getObjectExtension('.env')).toBe('');
});
