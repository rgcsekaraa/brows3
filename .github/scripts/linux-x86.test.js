const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { assertLinuxX86 } = require('../../scripts/package-linux-x86');

test('only accepts little-endian ELF32 for Intel 80386', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brows3-elf-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'brows3');
  const header = Buffer.alloc(20);
  Buffer.from('7f454c46', 'hex').copy(header);
  header[4] = 1;
  header[5] = 1;
  header.writeUInt16LE(3, 18);
  fs.writeFileSync(binary, header);
  assert.doesNotThrow(() => assertLinuxX86(binary));
  for (const [offset, value] of [[4, 2], [5, 2], [18, 40], [0, 0]]) {
    const invalid = Buffer.from(header);
    invalid[offset] = value;
    fs.writeFileSync(binary, invalid);
    assert.throws(() => assertLinuxX86(binary), /non-i386/);
  }
  fs.writeFileSync(binary, 'short');
  assert.throws(() => assertLinuxX86(binary), /non-i386/);
});
