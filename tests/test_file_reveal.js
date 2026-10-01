const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = require('../electron/core/storage');
const fileReveal = require('../electron/core/file_reveal');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-file-reveal-'));
const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-file-reveal-outside-'));

try {
  storage.initialize(root);
  const insidePath = path.join(storage.dirs.archive, '0000001_test.pdf');
  const outsidePath = path.join(outsideRoot, 'outside.pdf');
  fs.writeFileSync(insidePath, 'inside');
  fs.writeFileSync(outsidePath, 'outside');

  assert.strictEqual(fileReveal.isInsideStorage(insidePath), true, 'Archive file should be inside storage.');
  assert.strictEqual(fileReveal.isInsideStorage(outsidePath), false, 'External file must not be inside storage.');

  const selected = fileReveal.selectRevealPath({
    archive_file_path: insidePath,
    original_file_path: outsidePath,
  });
  assert.strictEqual(selected, path.resolve(insidePath), 'Safe archive path should be selected first.');

  let revealedPath = null;
  const result = fileReveal.revealDocument({
    archive_file_path: insidePath,
  }, {
    showItemInFolder: (targetPath) => { revealedPath = targetPath; },
  });
  assert.strictEqual(result.success, true, 'Reveal should report success for safe local paths.');
  assert.strictEqual(revealedPath, path.resolve(insidePath), 'Reveal should pass only the resolved safe path to shell.');

  assert.throws(
    () => fileReveal.selectRevealPath({ archive_file_path: outsidePath }),
    /داخل مجلد الأرشفة/,
    'External paths must be rejected.'
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
}

console.log('File reveal security tests passed.');
