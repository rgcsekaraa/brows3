const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.join(__dirname, 'validate-generated-release-metadata.js');
const version = '9.8.7';
const tag = `app-v${version}`;
const downloadBase = `https://github.com/rgcsekaraa/brows3/releases/download/${tag}`;
const platformAssets = {
  'darwin-aarch64': `Brows3_${version}_aarch64.app.tar.gz`,
  'darwin-x86_64': `Brows3_${version}_x64.app.tar.gz`,
  'linux-x86_64': `Brows3_${version}_amd64.AppImage`,
  'linux-aarch64': `Brows3_${version}_aarch64.AppImage`,
  'windows-x86_64': `Brows3_${version}_x64-setup.exe`,
};

const signature = Buffer.from(
  'untrusted comment: signature from tauri secret key\n' +
    `${'A'.repeat(120)}\n` +
    'trusted comment: timestamp:1786533390\tfile:Brows3\n' +
    `${'B'.repeat(120)}\n`
).toString('base64');

function createFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-release-metadata-test-'));
  const signatures = path.join(root, 'signatures');
  fs.mkdirSync(signatures);

  const assets = [
    {
      name: `Brows3_${version}_x64-setup.exe`,
      digest: `sha256:${'a'.repeat(64)}`,
    },
    {
      name: `Brows3_${version}_x64_en-US.msi`,
      digest: `sha256:${'b'.repeat(64)}`,
    },
  ];
  const release = { tag_name: tag, assets };
  const update = {
    version,
    platforms: Object.fromEntries(
      Object.entries(platformAssets).map(([platform, assetName]) => [
        platform,
        { url: `${downloadBase}/${assetName}`, signature },
      ])
    ),
  };

  for (const assetName of Object.values(platformAssets)) {
    fs.writeFileSync(path.join(signatures, `${assetName}.sig`), signature);
  }

  const winget = `Installers:
- Architecture: x64
  InstallerUrl: ${downloadBase}/Brows3_${version}_x64-setup.exe
  InstallerSha256: ${'A'.repeat(64)}
- Architecture: x64
  InstallerUrl: ${downloadBase}/Brows3_${version}_x64_en-US.msi
  InstallerSha256: ${'B'.repeat(64)}
`;

  const releasePath = path.join(root, 'release.json');
  const updatePath = path.join(root, 'update.json');
  const wingetPath = path.join(root, 'installer.yaml');
  fs.writeFileSync(releasePath, JSON.stringify(overrides.release || release));
  fs.writeFileSync(updatePath, JSON.stringify(overrides.update || update));
  fs.writeFileSync(wingetPath, overrides.winget || winget);

  const result = spawnSync(
    process.execPath,
    [script, releasePath, updatePath, wingetPath, signatures, version],
    { encoding: 'utf8' }
  );

  return { root, result, release, update, winget };
}

test('accepts canonical public URLs, exact signatures, and installer digests', (t) => {
  const { root, result } = createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated updater and Winget metadata/);
});

test('rejects temporary draft updater URLs', (t) => {
  const fixture = createFixture();
  const update = structuredClone(fixture.update);
  update.platforms['windows-x86_64'].url =
    `https://github.com/rgcsekaraa/brows3/releases/download/untagged-temporary/Brows3_${version}_x64-setup.exe`;
  fs.rmSync(fixture.root, { recursive: true, force: true });

  const { root, result } = createFixture({ update });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Updater URL/);
});

test('rejects a Not Found response in place of an updater signature', (t) => {
  const fixture = createFixture();
  const update = structuredClone(fixture.update);
  update.platforms['linux-x86_64'].signature = 'Not Found';
  fs.rmSync(fixture.root, { recursive: true, force: true });

  const { root, result } = createFixture({ update });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});

test('rejects temporary draft URLs in the Winget manifest', (t) => {
  const fixture = createFixture();
  const winget = fixture.winget.replace(
    `/releases/download/${tag}/`,
    '/releases/download/untagged-temporary/'
  );
  fs.rmSync(fixture.root, { recursive: true, force: true });

  const { root, result } = createFixture({ winget });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /temporary draft download URL/);
});
