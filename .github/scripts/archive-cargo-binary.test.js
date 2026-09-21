const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { archiveBinary, targets } = require('../../scripts/archive-cargo-binary');

for (const target of targets) {
  test(`binstall archive has the expected name and executable for ${target}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-archive-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'bin'));
    const binary = target.includes('windows') ? 'brows3.exe' : 'brows3';
    fs.writeFileSync(path.join(root, 'bin', binary), 'fixture', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'bin', 'unrelated-secret'), 'must not be archived');
    const archive = archiveBinary(root, '1.2.3', target, path.join(root, 'dist'));
    assert.equal(path.basename(archive), `brows3-v1.2.3-${target}.tar.gz`);
    assert.equal(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim(), binary);
    assert.throws(() => archiveBinary(root, '1.2.3', target, path.join(root, 'dist')), /overwrite/);
  });
}

test('rejects unsupported targets and path traversal', () => {
  assert.throws(() => archiveBinary('.', '../oops', targets[0], '.'), /Unsupported/);
  assert.throws(() => archiveBinary('.', '1.2.3', '../../oops', '.'), /Unsupported/);
});
