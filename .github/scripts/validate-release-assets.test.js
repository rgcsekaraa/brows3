const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.join(__dirname, 'validate-release-assets.js');
const version = '9.8.7';

const requiredNames = [
  `Brows3_${version}_aarch64.app.tar.gz`,
  `Brows3_${version}_aarch64.app.tar.gz.sig`,
  `Brows3_${version}_aarch64.AppImage`,
  `Brows3_${version}_aarch64.AppImage.sig`,
  `Brows3_${version}_aarch64.dmg`,
  `Brows3_${version}_amd64.AppImage`,
  `Brows3_${version}_amd64.AppImage.sig`,
  `Brows3_${version}_amd64.deb`,
  `Brows3_${version}_amd64.deb.sig`,
  `Brows3_${version}_arm64.deb`,
  `Brows3_${version}_arm64.deb.sig`,
  `Brows3_${version}_x64-portable.zip`,
  `Brows3_${version}_x64-setup.exe`,
  `Brows3_${version}_x64-setup.exe.sig`,
  `Brows3_${version}_x64.app.tar.gz`,
  `Brows3_${version}_x64.app.tar.gz.sig`,
  `Brows3_${version}_x64.dmg`,
  `Brows3_${version}_x64_en-US.msi`,
  `Brows3_${version}_x64_en-US.msi.sig`,
  'Brows3Team.Brows3.installer.yaml',
  'Brows3Team.Brows3.locale.en-US.yaml',
  'Brows3Team.Brows3.yaml',
];

function runValidator(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-release-test-'));
  const input = path.join(root, 'release.json');
  const release = {
    tag_name: `app-v${version}`,
    draft: true,
    prerelease: false,
    assets: requiredNames.map((name) => ({
      name,
      size: 128,
      digest: `sha256:${'a'.repeat(64)}`,
    })),
    ...overrides,
  };
  fs.writeFileSync(input, JSON.stringify(release));
  const result = spawnSync(process.execPath, [script, input, version], {
    encoding: 'utf8',
  });
  return { root, result };
}

test('accepts a complete, signed draft release', (t) => {
  const { root, result } = runValidator();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 22 required assets/);
});

test('rejects publishing with a missing platform asset', (t) => {
  const { root, result } = runValidator({
    assets: requiredNames.slice(1).map((name) => ({
      name,
      size: 128,
      digest: `sha256:${'b'.repeat(64)}`,
    })),
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required assets/i);
});

test('rejects a release that is already public', (t) => {
  const { root, result } = runValidator({ draft: false });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must remain a draft/i);
});
