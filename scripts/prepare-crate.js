const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Stage outside the checkout so Cargo cannot omit ignored frontend assets or
// accidentally include local credentials, build outputs, or review documents.
function prepareCrate(root, parent = os.tmpdir()) {
  const rust = path.join(root, 'src-tauri');
  const frontend = path.join(root, 'out');
  if (!fs.existsSync(path.join(frontend, 'index.html'))) {
    throw new Error('Missing out/index.html. Run pnpm build before preparing the crate.');
  }
  const config = JSON.parse(fs.readFileSync(path.join(rust, 'tauri.conf.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  let manifest = fs.readFileSync(path.join(rust, 'Cargo.toml'), 'utf8');
  const version = manifest.match(/^version = "([^"]+)"$/m)?.[1];
  if (version !== config.version || version !== packageJson.version) {
    throw new Error('Package, Cargo, and Tauri versions must match before publishing.');
  }
  if (!/^publish = false$/m.test(manifest) || !/^\[features\]$/m.test(manifest)) {
    throw new Error('Unexpected development manifest. Refusing to prepare a partial crate.');
  }
  manifest = manifest.replace(/^publish = false$/m,
    'publish = ["crates-io"]\nreadme = "README.md"\ninclude = ["src/**", "frontend/**", "icons/**", "capabilities/**", "Cargo.toml", "Cargo.lock", "build.rs", "tauri.conf.json", "windows-app-manifest.xml", "README.md", "LICENSE"]');
  manifest = manifest.replace('[features]', '[features]\ndefault = ["custom-protocol", "crate-distribution"]');
  config.build = { frontendDist: 'frontend' };
  // Native updater payloads install app bundles, not Cargo-managed binaries.
  // Keep this package from replacing a Cargo installation with an installer.
  if (config.plugins?.updater) config.plugins.updater.endpoints = [];
  const destination = fs.mkdtempSync(path.join(parent, 'brows3-crate-'));
  for (const entry of ['src', 'icons', 'capabilities', 'Cargo.lock', 'build.rs', 'windows-app-manifest.xml']) {
    fs.cpSync(path.join(rust, entry), path.join(destination, entry), { recursive: true, dereference: false });
  }
  fs.cpSync(frontend, path.join(destination, 'frontend'), { recursive: true, dereference: false });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  fs.copyFileSync(path.join(root, 'docs', 'CRATES_README.md'), path.join(destination, 'README.md'));
  fs.writeFileSync(path.join(destination, 'Cargo.toml'), manifest);
  fs.writeFileSync(path.join(destination, 'tauri.conf.json'), `${JSON.stringify(config, null, 2)}\n`);
  return destination;
}

if (require.main === module) {
  try {
    console.log(prepareCrate(path.resolve(__dirname, '..')));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareCrate };
