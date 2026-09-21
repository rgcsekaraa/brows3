const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const targets = [
  'aarch64-apple-darwin', 'x86_64-apple-darwin',
  'aarch64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
];

function archiveBinary(root, version, target, destination) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !targets.includes(target)) {
    throw new Error('Unsupported Cargo release version or target');
  }
  const name = target.includes('windows') ? 'brows3.exe' : 'brows3';
  const binary = path.join(root, 'bin', name);
  if (!fs.statSync(binary).isFile() || fs.statSync(binary).size === 0) {
    throw new Error('Missing or empty Cargo executable');
  }
  fs.mkdirSync(destination, { recursive: true });
  const archive = path.resolve(destination, `brows3-v${version}-${target}.tar.gz`);
  if (fs.existsSync(archive)) throw new Error(`Refusing to overwrite ${archive}`);
  // Stream to a Node-owned file descriptor. GNU tar interprets Windows drive
  // letters in archive paths as remote hosts (for example, D:), even in CI.
  const fd = fs.openSync(archive, 'wx');
  try {
    execFileSync('tar', ['-czf', '-', name], {
      cwd: path.resolve(path.dirname(binary)),
      stdio: ['ignore', fd, 'pipe'],
    });
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(archive);
    throw error;
  }
  fs.closeSync(fd);
  return archive;
}

if (require.main === module) {
  console.log(archiveBinary(...process.argv.slice(2)));
}
module.exports = { archiveBinary, targets };
