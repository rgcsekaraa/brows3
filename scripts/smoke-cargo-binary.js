const { spawn } = require('node:child_process');
const path = require('node:path');

// CI launches only the isolated Cargo installation, with no real user profiles.
const binary = path.resolve(process.argv[2]);
const linux = process.platform === 'linux';
const child = spawn(linux ? 'xvfb-run' : binary, linux ? ['-a', binary] : [], {
  env: { ...process.env, BROWS3_PORTABLE: '1', GDK_BACKEND: 'x11' },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let survived = false;
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
const timer = setTimeout(() => {
  survived = true;
  if (process.platform === 'win32') child.kill();
  else process.kill(-child.pid, 'SIGTERM');
}, 10000);
child.on('error', error => {
  clearTimeout(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.on('close', () => {
  clearTimeout(timer);
  process.stdout.write(output);
  if (!survived || /panicked at|Panic at|symbol lookup error|error while loading shared libraries/i.test(output)) {
    console.error('Cargo-installed application failed its startup smoke test.');
    process.exitCode = 1;
  }
});
