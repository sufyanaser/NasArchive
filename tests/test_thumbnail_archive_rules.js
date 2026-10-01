/**
 * NAS Archive — Thumbnail and Archive Rules Regression Tests
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dbManager = require('../electron/core/db');
const storage = require('../electron/core/storage');
const docService = require('../electron/core/documents');
const thumbnail = require('../electron/core/thumbnail');
const archiveRules = require('../electron/core/archive_rules');

const TEST_DIR = path.resolve(__dirname, '..', 'runtime', 'test_thumbnail_archive_rules');
const TEST_DB = path.join(TEST_DIR, 'thumbnail_rules.sqlite');

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n' +
  '0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'binary'
);

async function run() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  storage.initialize(TEST_DIR);
  dbManager.initialize(TEST_DB);

  const plan = archiveRules.buildArchivePlan({
    document_id: 42,
    department: '../تناسق',
    document_type_name: 'كتاب صادر',
    created_date: '2026-09-30',
    title: 'تقرير/رسمي',
  });
  assert.ok(plan.storageKey.includes(path.join('تناسق', '2026', '09', 'كتاب صادر')));
  assert.strictEqual(plan.storageKey.includes('..'), false, 'Storage key must reject traversal.');

  const staged = storage.saveToStaging('sample.pdf', MINIMAL_PDF);
  const archived = storage.storeArchivedByKey(plan.storageKey, staged.path);
  assert.ok(fs.existsSync(archived.path), 'Archive target must exist.');
  assert.ok(archived.filename.includes(path.join('تناسق', '2026', '09')), 'Archive filename stores logical key.');

  const doc = docService.createDocument({
    title: 'وثيقة اختبار المصغرات',
    content: '',
    created_date: '2026-09-30',
    original_filename: 'sample.pdf',
    original_file_path: staged.path,
    original_checksum: staged.checksum,
    original_size: staged.size,
    original_mime_type: 'application/pdf',
    archive_filename: archived.filename,
    archive_file_path: archived.path,
    archive_checksum: archived.checksum,
    archive_size: archived.size,
    page_count: 1,
    status: 'INBOX',
  });
  assert.strictEqual(doc.thumbnail_path, null, 'Old/new records may exist without thumbnails initially.');

  const thumb = await thumbnail.generateForPdf(doc.id, archived.path, { title: doc.title });
  assert.strictEqual(thumb.success, true);
  assert.ok(fs.existsSync(thumb.path), 'Thumbnail SVG must be stored.');
  assert.ok(thumb.relativePath.endsWith(`${String(doc.id).padStart(7, '0')}.svg`), 'Thumbnail filename must be deterministic by document id.');

  const updated = docService.setThumbnailPath(doc.id, thumb.relativePath);
  assert.strictEqual(updated.thumbnail_path, thumb.relativePath);

  const reused = await thumbnail.generateForPdf(doc.id, archived.path, { title: doc.title });
  assert.strictEqual(reused.reused, true, 'Existing thumbnail must be reused.');

  const dataUrl = thumbnail.readDataUrl(doc.id);
  assert.strictEqual(dataUrl.success, true);
  assert.ok(dataUrl.dataUrl.startsWith('data:image/svg+xml;base64,'));

  const corruptPath = path.join(storage.dirs.staging, 'corrupt.pdf');
  fs.writeFileSync(corruptPath, Buffer.from('NOT_A_PDF'));
  await assert.rejects(
    () => thumbnail.generateForPdf(doc.id + 1, corruptPath),
    /valid PDF/
  );
  await assert.rejects(
    () => thumbnail.generateForPdf(doc.id + 2, path.join(storage.dirs.staging, 'missing.pdf')),
    /missing/
  );
  assert.throws(() => thumbnail.readDataUrl('../bad'), /Invalid document id/);

  dbManager.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  console.log('Thumbnail and archive rules regression tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
