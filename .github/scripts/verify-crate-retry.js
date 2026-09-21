const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const targets = [
  ['macos-latest', 'aarch64-apple-darwin'],
  ['macos-15-intel', 'x86_64-apple-darwin'],
  ['ubuntu-22.04', 'x86_64-unknown-linux-gnu'],
  ['ubuntu-22.04-arm', 'aarch64-unknown-linux-gnu'],
  ['windows-2022', 'x86_64-pc-windows-msvc'],
];

function verifySource(run, jobs, release, commit, tag) {
  assert.match(tag, /^app-v\d+\.\d+\.\d+$/);
  assert.equal(run.path, '.github/workflows/crates.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'failure');
  assert.equal(run.head_branch, tag);
  assert.equal(run.head_sha, commit.sha);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  for (const name of ['package', ...targets.map(([runner, target]) => `install (${runner}, ${target})`)]) {
    const matches = jobs.jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1, `Expected one job: ${name}`);
    assert.equal(matches[0].conclusion, 'success', `Unverified job: ${name}`);
  }
  assert.equal(jobs.jobs.find(job => job.name === 'publish')?.conclusion, 'failure');
}

function verifyAssets(release, version, directory) {
  for (const [, target] of targets) {
    const name = `brows3-v${version}-${target}.tar.gz`;
    const matches = release.assets.filter(asset => asset.name === name);
    assert.equal(matches.length, 1, `Missing or duplicate release asset: ${name}`);
    const asset = matches[0];
    const bytes = fs.readFileSync(path.join(directory, name));
    assert.ok(bytes.length > 0);
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.size, bytes.length, `Size mismatch: ${name}`);
    assert.equal(asset.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`, `Digest mismatch: ${name}`);
  }
}

if (require.main === module) {
  const [mode, directory, tag] = process.argv.slice(2);
  assert.match(tag, /^app-v\d+\.\d+\.\d+$/);
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'));
  if (mode === 'source') verifySource(read('run'), read('jobs'), read('release'), read('commit'), tag);
  else {
    assert.equal(mode, 'assets');
    verifyAssets(read('release'), tag.slice(5), path.join(directory, 'binaries'));
  }
  console.log(`Verified crate retry ${mode} for ${tag}.`);
}

module.exports = { verifySource, verifyAssets, targets };
