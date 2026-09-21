const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function assertLinuxX86(binary) {
  const header = Buffer.alloc(20);
  const fd = fs.openSync(binary, 'r');
  try {
    if (fs.readSync(fd, header, 0, 20, 0) !== 20 ||
        header.subarray(0, 4).toString('hex') !== '7f454c46' ||
        header[4] !== 1 || header[5] !== 1 || header.readUInt16LE(18) !== 3) {
      throw new Error('Refusing to label a non-i386 ELF executable as 32-bit Linux');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function packageLinuxX86(installation, output) {
  const root = path.resolve(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const binary = path.resolve(installation, 'bin/brows3');
  assertLinuxX86(binary);
  fs.mkdirSync(output, { recursive: true });
  const archive = path.resolve(output, `Brows3_${version}_i386.deb`);
  if (fs.existsSync(archive)) throw new Error('Refusing to overwrite a Debian package');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-i386-deb-'));
  try {
    const staging = path.join(temporary, 'package');
    for (const dir of ['DEBIAN', 'usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/128x128/apps', 'usr/share/doc/brows3', 'debian']) {
      fs.mkdirSync(path.join(staging, dir), { recursive: true });
    }
    fs.copyFileSync(binary, path.join(staging, 'usr/bin/brows3'));
    fs.chmodSync(path.join(staging, 'usr/bin/brows3'), 0o755);
    fs.copyFileSync(path.join(root, 'src-tauri/icons/128x128.png'), path.join(staging, 'usr/share/icons/hicolor/128x128/apps/brows3.png'));
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(staging, 'usr/share/doc/brows3/copyright'));
    fs.writeFileSync(path.join(staging, 'usr/share/applications/brows3.desktop'), '[Desktop Entry]\nType=Application\nName=Brows3\nComment=S3-compatible object storage browser\nExec=brows3\nIcon=brows3\nTerminal=false\nCategories=Network;FileTransfer;\n');
    // Derive the actual runtime dependencies from the ELF links in this image.
    fs.writeFileSync(path.join(staging, 'debian/control'), 'Source: brows3\nMaintainer: Brows3 Team\n\nPackage: brows3\nArchitecture: i386\nDescription: S3 browser\n');
    const deps = execFileSync('dpkg-shlibdeps', ['-O', '-eusr/bin/brows3'], { cwd: staging, encoding: 'utf8' })
      .split('\n').find(line => line.startsWith('shlibs:Depends='))?.slice('shlibs:Depends='.length);
    if (!deps) throw new Error('Could not determine runtime dependencies');
    // Packaging metadata used only by dpkg-shlibdeps must not enter the installer.
    fs.rmSync(path.join(staging, 'debian'), { recursive: true });
    fs.writeFileSync(path.join(staging, 'DEBIAN/control'), `Package: brows3\nVersion: ${version}\nArchitecture: i386\nMaintainer: Brows3 Team\nSection: net\nPriority: optional\nDepends: ${deps}\nDescription: S3 browser for Intel/AMD 32-bit Linux\n Experimental i686 build with an embedded UI. Native in-app updates are disabled.\n`);
    execFileSync('dpkg-deb', ['--root-owner-group', '--build', staging, archive], { stdio: 'inherit' });
    return archive;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(packageLinuxX86(...process.argv.slice(2)));
module.exports = { assertLinuxX86 };
