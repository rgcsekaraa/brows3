const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const [tool, manifest, archive, target, destination] = process.argv.slice(2);
  const text = fs.readFileSync(manifest, 'utf8');
  const template = text.match(/^pkg-url = "([^"]+)"$/m)?.[1];
  const version = text.match(/^version = "([^"]+)"$/m)?.[1];
  if (!template || !version || !template.startsWith('{ repo }/')) {
    throw new Error('Missing expected binstall release URL template');
  }
  const requestPath = template.replace('{ repo }', '').replaceAll('{ version }', version).replaceAll('{ target }', target);
  if (path.basename(requestPath) !== path.basename(archive)) throw new Error('Archive does not match binstall metadata');
  const server = http.createServer((req, res) => {
    if (req.url !== requestPath || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': fs.statSync(archive).size, 'Content-Type': 'application/gzip' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(archive).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    fs.mkdirSync(destination, { recursive: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const args = ['--manifest-path', manifest, '--pkg-url', template.replace('{ repo }', origin),
      '--targets', target, '--install-path', destination, '--strategies', 'crate-meta-data',
      '--disable-telemetry', '--no-discover-github-token', '--no-confirm', '--allow-insecure-http', 'brows3'];
    await new Promise((resolve, reject) => {
      const child = spawn(tool, args, { stdio: 'inherit' });
      const timer = setTimeout(() => child.kill(), 60000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`binstall failed with status ${code}`));
      });
    });
    const binary = path.join(destination, target.includes('windows') ? 'brows3.exe' : 'brows3');
    if (!fs.statSync(binary).size) throw new Error('binstall did not install an executable');
    console.log(`Verified binstall installation for ${target}`);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
