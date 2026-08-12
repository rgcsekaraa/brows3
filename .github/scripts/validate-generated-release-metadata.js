const fs = require('node:fs');
const path = require('node:path');

const [releaseInfoPath, updateManifestPath, wingetInstallerPath, signatureDir, version] = process.argv.slice(2);

if (
  !releaseInfoPath ||
  !updateManifestPath ||
  !wingetInstallerPath ||
  !signatureDir ||
  !/^\d+\.\d+\.\d+$/.test(version || '')
) {
  console.error(
    'Usage: node .github/scripts/validate-generated-release-metadata.js ' +
      '<release-info.json> <update.json> <winget-installer.yaml> <signature-dir> <version>'
  );
  process.exit(1);
}

const release = JSON.parse(fs.readFileSync(releaseInfoPath, 'utf8'));
const update = JSON.parse(fs.readFileSync(updateManifestPath, 'utf8'));
const wingetInstaller = fs.readFileSync(wingetInstallerPath, 'utf8');
const tag = `app-v${version}`;
const downloadBase = `https://github.com/rgcsekaraa/brows3/releases/download/${tag}`;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (release.tag_name !== tag) {
  fail(`Expected release tag ${tag}, found ${release.tag_name || '<missing>'}.`);
}

if (update.version !== version) {
  fail(`Expected update manifest version ${version}, found ${update.version || '<missing>'}.`);
}

const expectedPlatforms = new Map([
  ['darwin-aarch64', `Brows3_${version}_aarch64.app.tar.gz`],
  ['darwin-x86_64', `Brows3_${version}_x64.app.tar.gz`],
  ['linux-x86_64', `Brows3_${version}_amd64.AppImage`],
  ['linux-aarch64', `Brows3_${version}_aarch64.AppImage`],
  ['windows-x86_64', `Brows3_${version}_x64-setup.exe`],
]);

const platformNames = Object.keys(update.platforms || {}).sort();
const expectedPlatformNames = [...expectedPlatforms.keys()].sort();
if (JSON.stringify(platformNames) !== JSON.stringify(expectedPlatformNames)) {
  fail(`Update manifest platforms do not match the required set: ${expectedPlatformNames.join(', ')}.`);
}

for (const [platform, assetName] of expectedPlatforms) {
  const entry = update.platforms[platform];
  const expectedUrl = `${downloadBase}/${assetName}`;
  if (entry.url !== expectedUrl) {
    fail(`Updater URL for ${platform} must be ${expectedUrl}, found ${entry.url || '<missing>'}.`);
  }

  const signatureName = `${assetName}.sig`;
  const signaturePath = path.join(signatureDir, signatureName);
  if (!fs.existsSync(signaturePath)) {
    fail(`Missing downloaded updater signature ${signatureName}.`);
  }

  const expectedSignature = fs.readFileSync(signaturePath, 'utf8').trim();
  if (entry.signature !== expectedSignature) {
    fail(`Updater signature for ${platform} does not match ${signatureName}.`);
  }

  if (expectedSignature.length < 300 || !/^[A-Za-z0-9+/]+={0,2}$/.test(expectedSignature)) {
    fail(`Updater signature ${signatureName} is not a valid encoded Tauri signature.`);
  }

  const decodedSignature = Buffer.from(expectedSignature, 'base64').toString('utf8');
  if (
    !decodedSignature.startsWith('untrusted comment: signature from tauri secret key\n') ||
    !decodedSignature.includes('\ntrusted comment: timestamp:')
  ) {
    fail(`Updater signature ${signatureName} does not contain a Tauri minisign envelope.`);
  }
}

if (wingetInstaller.includes('/releases/download/untagged-')) {
  fail('Winget installer manifest contains a temporary draft download URL.');
}

const releaseAssets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
for (const assetName of [
  `Brows3_${version}_x64-setup.exe`,
  `Brows3_${version}_x64_en-US.msi`,
]) {
  const asset = releaseAssets.get(assetName);
  if (!asset) {
    fail(`Release metadata is missing Winget installer asset ${assetName}.`);
  }

  const sha256 = String(asset.digest || '').replace(/^sha256:/, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(sha256)) {
    fail(`Release metadata has no verified SHA256 digest for ${assetName}.`);
  }

  const expectedBlock = `InstallerUrl: ${downloadBase}/${assetName}\n  InstallerSha256: ${sha256}`;
  if (!wingetInstaller.includes(expectedBlock)) {
    fail(`Winget installer metadata does not match the public URL and digest for ${assetName}.`);
  }
}

console.log(`Validated updater and Winget metadata for ${tag}.`);
