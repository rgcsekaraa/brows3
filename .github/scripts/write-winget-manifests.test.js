const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.join(__dirname, 'write-winget-manifests.js');

function runGenerator(releaseInfo, version = '9.8.7') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-winget-test-'));
  const input = path.join(root, 'release.json');
  const output = path.join(root, 'manifests');
  fs.writeFileSync(input, JSON.stringify(releaseInfo));
  const result = spawnSync(process.execPath, [script, input, output], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_VERSION: version },
  });
  return { root, output, result };
}

test('updates the published package identifier with both Windows installers', (t) => {
  const releaseInfo = {
    tag_name: 'app-v9.8.7',
    published_at: '2026-08-12T09:30:00Z',
    assets: [
      {
        name: 'Brows3_9.8.7_x64_en-US.msi',
        browser_download_url: 'https://example.test/Brows3_9.8.7_x64_en-US.msi',
        digest: `sha256:${'a'.repeat(64)}`,
      },
      {
        name: 'Brows3_9.8.7_x64-setup.exe',
        browser_download_url: 'https://example.test/Brows3_9.8.7_x64-setup.exe',
        digest: `sha256:${'b'.repeat(64)}`,
      },
    ],
  };
  const { root, output, result } = runGenerator(releaseInfo);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(output).sort(), [
    'Brows3Team.Brows3.installer.yaml',
    'Brows3Team.Brows3.locale.en-US.yaml',
    'Brows3Team.Brows3.yaml',
  ]);

  const installer = fs.readFileSync(
    path.join(output, 'Brows3Team.Brows3.installer.yaml'),
    'utf8'
  );
  assert.match(installer, /PackageIdentifier: Brows3Team\.Brows3/);
  assert.match(installer, /ReleaseDate: 2026-08-12/);
  assert.match(installer, /InstallerType: wix/);
  assert.match(installer, /Scope: machine/);
  assert.match(installer, /InstallerType: nullsoft/);
  assert.match(installer, /Scope: user/);
  assert.match(installer, new RegExp('A'.repeat(64)));
  assert.match(installer, new RegExp('B'.repeat(64)));
});

test('rejects assets without a verified GitHub SHA256 digest', (t) => {
  const { root, result } = runGenerator({
    assets: [
      {
        name: 'Brows3_9.8.7_x64_en-US.msi',
        browser_download_url: 'https://example.test/installer.msi',
      },
    ],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing SHA256 digest/);
});
