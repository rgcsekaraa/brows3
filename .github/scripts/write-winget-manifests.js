const fs = require('fs');
const path = require('path');

const releaseInfoPath = process.argv[2];
const outputDir = process.argv[3];

if (!releaseInfoPath || !outputDir) {
  console.error('Usage: node .github/scripts/write-winget-manifests.js <release-info.json> <output-dir>');
  process.exit(1);
}

const releaseInfo = JSON.parse(fs.readFileSync(releaseInfoPath, 'utf8'));
const version = process.env.RELEASE_VERSION || String(releaseInfo.tag_name || '').replace(/^app-v/, '');
// This identifier is already published in microsoft/winget-pkgs. Changing it
// would create a second package instead of updating existing installations.
const packageIdentifier = 'Brows3Team.Brows3';
const manifestVersion = '1.12.0';
const releaseUrl = `https://github.com/rgcsekaraa/brows3/releases/tag/app-v${version}`;
const downloadBaseUrl = `https://github.com/rgcsekaraa/brows3/releases/download/app-v${version}`;

if (!version) {
  console.error('Unable to determine release version.');
  process.exit(1);
}

const windowsInstallers = (releaseInfo.assets || []).filter((asset) => (
  asset.name === `Brows3_${version}_x64_en-US.msi` ||
  asset.name === `Brows3_${version}_x64-setup.exe`
));

if (windowsInstallers.length === 0) {
  console.error(`Missing Windows MSI or NSIS installer asset for ${version}.`);
  process.exit(1);
}

const installerEntries = windowsInstallers.map((asset) => {
  const digest = String(asset.digest || '');
  const sha256 = digest.startsWith('sha256:')
    ? digest.slice('sha256:'.length).toUpperCase()
    : '';
  if (!/^[A-F0-9]{64}$/.test(sha256)) {
    console.error(`Missing SHA256 digest for ${asset.name}.`);
    process.exit(1);
  }

  // Draft release metadata contains a temporary `untagged-*` URL which stops
  // working as soon as the release is published. Winget manifests must always
  // use the stable, public tag URL.
  const installerUrl = `${downloadBaseUrl}/${encodeURIComponent(asset.name)}`;

  if (asset.name.endsWith('.msi')) {
    return `- Architecture: x64
  InstallerType: wix
  Scope: machine
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${sha256}`;
  }

  return `- Architecture: x64
  InstallerType: nullsoft
  Scope: user
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${sha256}
  ProductCode: Brows3
  InstallerSwitches:
    Silent: /S
    SilentWithProgress: /S
  AppsAndFeaturesEntries:
  - DisplayName: Brows3
    Publisher: Brows3 Team
    DisplayVersion: ${version}
    ProductCode: Brows3
  InstallationMetadata:
    DefaultInstallLocation: '%LocalAppData%\\Brows3'`;
});

const releaseDate = String(releaseInfo.published_at || releaseInfo.created_at || '').slice(0, 10);
const releaseDateLine = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
  ? `ReleaseDate: ${releaseDate}\n`
  : '';

fs.mkdirSync(outputDir, { recursive: true });

const writeManifest = (suffix, content) => {
  const filename = suffix
    ? `${packageIdentifier}.${suffix}.yaml`
    : `${packageIdentifier}.yaml`;

  fs.writeFileSync(
    path.join(outputDir, filename),
    `${content.trim()}\n`
  );
};

writeManifest('', `
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${manifestVersion}
`);

writeManifest('installer', `
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
InstallerLocale: en-US
Platform:
- Windows.Desktop
MinimumOSVersion: 10.0.17763.0
UpgradeBehavior: install
InstallModes:
- interactive
- silent
${releaseDateLine}Installers:
${installerEntries.join('\n')}
ManifestType: installer
ManifestVersion: ${manifestVersion}
`);

writeManifest('locale.en-US', `
PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Brows3 Team
PublisherUrl: https://github.com/rgcsekaraa
PublisherSupportUrl: https://github.com/rgcsekaraa/brows3/issues
Author: rgcsekaraa
PackageName: Brows3
PackageUrl: https://github.com/rgcsekaraa/brows3
License: MIT
LicenseUrl: https://github.com/rgcsekaraa/brows3/blob/main/LICENSE
Copyright: Copyright (c) 2024 Brows3
ShortDescription: A lightning-fast S3 browser, S3 explorer, and S3 desktop client.
Description: Brows3 is a high-performance Amazon S3 browser, S3 explorer, and S3 desktop client for AWS S3 and S3-compatible object storage including MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces, and custom endpoints.
Moniker: brows3
Tags:
- amazon-s3
- aws-s3
- cloudflare-r2
- minio
- object-storage
- s3
- s3-browser
- tauri
- wasabi
ReleaseNotesUrl: ${releaseUrl}
ManifestType: defaultLocale
ManifestVersion: ${manifestVersion}
`);

console.log(`Wrote winget manifests for ${packageIdentifier} ${version} to ${outputDir}`);
