const fs = require('node:fs');

const releaseInfoPath = process.argv[2];
const version = process.argv[3];

if (!releaseInfoPath || !/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node .github/scripts/validate-release-assets.js <release-info.json> <version>');
  process.exit(1);
}

const release = JSON.parse(fs.readFileSync(releaseInfoPath, 'utf8'));
const expectedTag = `app-v${version}`;

if (release.tag_name !== expectedTag) {
  console.error(`Expected release tag ${expectedTag}, found ${release.tag_name || '<missing>'}.`);
  process.exit(1);
}

if (release.draft !== true) {
  console.error(`Release ${expectedTag} must remain a draft until validation finishes.`);
  process.exit(1);
}

if (release.prerelease === true) {
  console.error(`Release ${expectedTag} must not be marked as a prerelease.`);
  process.exit(1);
}

const requiredAssets = [
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

const assets = Array.isArray(release.assets) ? release.assets : [];
const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));
const missing = requiredAssets.filter((name) => !assetsByName.has(name));

if (missing.length > 0) {
  console.error(`Release ${expectedTag} is missing required assets:\n- ${missing.join('\n- ')}`);
  process.exit(1);
}

for (const name of requiredAssets) {
  const asset = assetsByName.get(name);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    console.error(`Release asset ${name} is empty or has an invalid size.`);
    process.exit(1);
  }
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(String(asset.digest || ''))) {
    console.error(`Release asset ${name} has no verified SHA256 digest.`);
    process.exit(1);
  }
}

console.log(`Validated ${requiredAssets.length} required assets for ${expectedTag}.`);
