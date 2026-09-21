const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { verifySource, verifyAssets, targets } = require('./verify-crate-retry');

function fixture() {
  return {
    run: { path: '.github/workflows/crates.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', head_branch: 'app-v0.2.46', head_sha: 'verified-commit' },
    jobs: { jobs: [
      { name: 'package', conclusion: 'success' },
      ...targets.map(([runner, target]) => ({ name: `install (${runner}, ${target})`, conclusion: 'success' })),
      { name: 'publish', conclusion: 'failure' },
    ] },
    release: { tag_name: 'app-v0.2.46', draft: false, prerelease: false },
    commit: { sha: 'verified-commit' },
  };
}

const check = f => verifySource(f.run, f.jobs, f.release, f.commit, 'app-v0.2.46');
test('accepts a failed publisher only after all exact-tag build jobs passed', () => check(fixture()));
test('rejects wrong revisions, workflows, releases and unverified jobs', () => {
  for (const mutate of [
    f => { f.commit.sha = 'different'; },
    f => { f.run.head_branch = 'main'; },
    f => { f.run.path = '.github/workflows/other.yml'; },
    f => { f.run.status = 'in_progress'; },
    f => { f.release.draft = true; },
    f => { f.release.prerelease = true; },
    f => { f.release.tag_name = 'app-v0.2.45'; },
    f => { f.jobs.jobs[1].conclusion = 'failure'; },
    f => { f.jobs.jobs.pop(); },
    f => { f.jobs.jobs.push(f.jobs.jobs[0]); },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => check(f));
  }
});
test('requires all five published archives to match tested artifact hashes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-retry-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const release = { assets: targets.map(([, target]) => {
    const name = `brows3-v0.2.46-${target}.tar.gz`;
    const bytes = Buffer.from(target);
    fs.writeFileSync(path.join(directory, name), bytes);
    return { name, state: 'uploaded', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }) };
  verifyAssets(release, '0.2.46', directory);
  const changed = structuredClone(release);
  changed.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => verifyAssets(changed, '0.2.46', directory), /Digest mismatch/);
  release.assets.pop();
  assert.throws(() => verifyAssets(release, '0.2.46', directory), /Missing/);
});
