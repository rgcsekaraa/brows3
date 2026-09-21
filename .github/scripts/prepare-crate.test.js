const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { prepareCrate } = require('../../scripts/prepare-crate');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-crate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities', 'out', 'docs']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of ['src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/windows-app-manifest.xml', 'src-tauri/src/main.rs', 'LICENSE', 'docs/CRATES_README.md', 'out/index.html', '.env']) {
    fs.writeFileSync(path.join(root, file), 'fixture');
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '1.2.3', build: { frontendDist: '../out', devUrl: 'http://localhost:3001' }, plugins: { updater: { endpoints: ['https://example.com/update.json'] } } }));
  fs.writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "1.2.3"\npublish = false\n[features]\ncustom-protocol = ["tauri/custom-protocol"]\n');
  return root;
}

test('stages a self-contained production crate without changing development files', (t) => {
  const root = fixture(t);
  const staged = prepareCrate(root, root);
  const manifest = fs.readFileSync(path.join(staged, 'Cargo.toml'), 'utf8');
  assert.match(manifest, /publish = \["crates-io"\]/);
  assert.match(manifest, /default = \["custom-protocol", "crate-distribution"\]/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staged, 'tauri.conf.json'))).build, { frontendDist: 'frontend' });
  assert.ok(fs.existsSync(path.join(staged, 'frontend/index.html')));
  assert.ok(!fs.existsSync(path.join(staged, '.env')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staged, 'tauri.conf.json'))).plugins.updater.endpoints, []);
  assert.match(fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'), /publish = false/);
});

test('rejects missing frontend', (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'out/index.html'));
  assert.throws(() => prepareCrate(root, root), /pnpm build/);
});

test('rejects mismatched release versions', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.4"}');
  assert.throws(() => prepareCrate(root, root), /versions must match/);
});
