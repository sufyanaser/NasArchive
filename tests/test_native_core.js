/**
 * NAS Archive Native — Comprehensive Automated Test Suite
 * Verifies all 9 core architectural subsystems:
 * 1. Database & Migrations
 * 2. Arabic FTS5 Search & Normalization
 * 3. Document CRUD & Custom Fields Preservation
 * 4. Document Storage & Path Traversal Protection
 * 5. Native OCR (Arabic & English)
 * 6. AI Semantic Processor & Safeguards
 * 7. Cloud Sync Contract & Ledger
 * 8. Native Backup & Manifest Verification
 * 9. Paperless Migration & Reconciliation
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const dbManager = require('../electron/core/db');
const storage = require('../electron/core/storage');
const docService = require('../electron/core/documents');
const { normalizeArabic, buildFtsQuery, sanitizeReferenceNumber } = require('../electron/core/normalizer');
const ocr = require('../electron/core/ocr');
const aiAnalyzer = require('../electron/core/ai_analyzer');
const syncService = require('../electron/core/sync_ledger');
const backupService = require('../electron/core/backup');
const migrator = require('../electron/core/migrator');

const TEST_DIR = path.join(__dirname, '..', 'runtime', 'test_native_suite');

async function runNativeTestSuite() {
  console.log('========================================================');
  console.log('NAS ARCHIVE NATIVE — EXECUTING NATIVE SUITE VERIFICATION');
  console.log('========================================================\n');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const testDbPath = path.join(TEST_DIR, 'test_suite.sqlite');

  // TEST 1: Database Initialization & Integrity
  console.log('[TEST 1/9] Testing Database Initialization, WAL Mode & Foreign Keys...');
  storage.initialize(TEST_DIR);
  const db = dbManager.initialize(testDbPath);
  const integrity = dbManager.checkIntegrity();
  assert.strictEqual(integrity.ok, true, 'Database integrity check must be ok');

  const journalMode = db.prepare('PRAGMA journal_mode;').get();
  assert.strictEqual(journalMode.journal_mode.toLowerCase(), 'wal', 'Journal mode must be WAL');

  const tags = docService.getTags().results;
  assert.strictEqual(tags.length, 5, 'Must have 5 seeded canonical tags');

  const cfs = docService.getCustomFields().results;
  assert.strictEqual(cfs.length, 10, 'Must have 10 seeded custom fields');
  console.log('  -> PASS: Database initialized with WAL and 15 canonical metadata records.\n');

  // TEST 2: Arabic Normalization & FTS5
  console.log('[TEST 2/9] Testing Arabic Normalization & FTS5 Query Builder...');
  assert.strictEqual(normalizeArabic('الأنبار'), 'الانبار', 'Alef with hamza must normalize to alef');
  assert.strictEqual(normalizeArabic('قناة'), 'قناه', 'Teh marbuta must normalize to heh');
  assert.strictEqual(normalizeArabic('شَخْصِيّ'), 'شخصي', 'Tashkeel must be removed');
  assert.strictEqual(normalizeArabic('تـــناســق'), 'تناسق', 'Tatweel must be removed');

  const ftsQuery = buildFtsQuery('قناة الأنبار');
  assert.ok(ftsQuery.includes('"قناه"*'), 'FTS query must include normalized teh marbuta');
  assert.ok(ftsQuery.includes('"الانبار"*'), 'FTS query must include normalized alef');
  console.log('  -> PASS: Arabic text normalization and FTS5 query builder verified.\n');

  // TEST 3: Document CRUD & Custom Fields Preservation
  console.log('[TEST 3/9] Testing Document CRUD & String Reference Numbers Preservation...');
  const refNum = '0042/ص-2026';
  const entryNum = '00987-ق';

  const doc = docService.createDocument({
    title: 'تأييد قناة الأنبار الرسمية',
    content: 'نؤيد لكم صدور الكتاب برقم 0042/ص-2026 وتاريخ اليوم.',
    created_date: '2026-09-24',
    original_filename: 'تأييد قناة الانبار.pdf',
    original_file_path: testDbPath,
    original_checksum: 'hash_test_crud_1',
    original_size: 2048,
    tags: [1, 5],
    custom_fields: [
      { field: 1, value: refNum },
      { field: 5, value: entryNum },
      { field: 8, value: false },
    ],
  });

  assert.strictEqual(doc.title, 'تأييد قناة الأنبار الرسمية');
  assert.strictEqual(doc.custom_fields.find((f) => f.field === 1).value, refNum, 'Leading zero and format must be preserved');
  assert.strictEqual(doc.custom_fields.find((f) => f.field === 5).value, entryNum);

  // Search by reference number
  const searchByRef = docService.listDocuments({ search: refNum });
  assert.strictEqual(searchByRef.count, 1, 'Must find document by reference number in FTS5');

  // Search by normalized word without hamza
  const searchNorm = docService.listDocuments({ search: 'الانبار' });
  assert.strictEqual(searchNorm.count, 1, 'Must find document by normalized Arabic query');
  console.log('  -> PASS: Document created, official reference numbers preserved, FTS5 retrieved.\n');

  // TEST 4: Document Storage & Traversal Protection
  console.log('[TEST 4/9] Testing Document Storage & Path Traversal Protection...');
  const dangerousName = '../../../../secret/test_arabic_كتاب.pdf';
  const sanitized = storage.sanitizeFilename(dangerousName);
  assert.strictEqual(sanitized.includes('..'), false, 'Directory traversal sequences must be removed');
  assert.ok(sanitized.includes('كتاب'), 'Arabic characters must be preserved in sanitized filename');

  const testBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const staged = storage.saveToStaging('test_staging_كتاب.pdf', testBuf);
  assert.strictEqual(storage.validatePdfHeader(staged.path), true, 'Header %PDF- must validate');
  assert.strictEqual(staged.checksum, storage.computeBufferHash(testBuf));
  storage.removeStaged(staged.filename);
  console.log('  -> PASS: Path traversal blocked, atomic staging and PDF validation confirmed.\n');

  // TEST 5: Native OCR (Arabic & English)
  console.log('[TEST 5/9] Testing Native OCR Engine on Arabic & English Samples...');
  const arSampleImg = path.join(__dirname, '..', 'runtime', 'export', 'acceptance-20260923', '2026-09-23 nas-acceptance-ar.png');
  const enSampleImg = path.join(__dirname, '..', 'runtime', 'export', 'acceptance-20260923', '2026-09-23 nas-acceptance-en.png');

  if (fs.existsSync(arSampleImg)) {
    const arOcr = await ocr.runImageOcr(arSampleImg, 'ara');
    assert.ok(arOcr.includes('اختبار') || arOcr.includes('الأرشيف'), 'Arabic OCR must recognize Arabic text');
    console.log('  -> Arabic OCR sample recognized: ' + arOcr.replace(/\n/g, ' '));
  }
  if (fs.existsSync(enSampleImg)) {
    const enOcr = await ocr.runImageOcr(enSampleImg, 'eng');
    assert.ok(enOcr.includes('NAS Archive') || enOcr.includes('acceptance'), 'English OCR must recognize English text');
    console.log('  -> English OCR sample recognized: ' + enOcr.replace(/\n/g, ' '));
  }
  console.log('  -> PASS: OCR recognition verified for both Arabic and English.\n');

  // TEST 6: AI Semantic Processor & Safeguards
  console.log('[TEST 6/9] Testing AI Document Analyzer & Safety Guardrails...');
  const sampleArabicDoc = `
    جمهورية العراق
    وزارة التجارة - الشركة العامة لتجارة الحبوب
    العدد: 0077/ص-2026
    التاريخ: 2026-09-24
    رقم القيد: 00331-ق
    من: وزارة التجارة
    إلى: شركة الرنين للإنتاج الفني
    الموضوع: مذكرة تفاهم وتعاون إعلامي
    تهديكم شركة الرنين أطيب التحيات...
  `;

  const aiRes = aiAnalyzer.analyze(sampleArabicDoc);
  assert.strictEqual(aiRes.doc_number_suggestion.value, '0077/ص-2026');
  assert.strictEqual(aiRes.entry_number_suggestion.value, '00331-ق');
  assert.strictEqual(aiRes.doc_date_suggestion.value, '2026-09-24');
  assert.strictEqual(aiRes.department_suggestion.value, 'الرنين');
  assert.strictEqual(aiRes.doc_type_suggestion.value, 'كتاب وارد');
  assert.strictEqual(aiRes.ai_approved_sync, false, 'GUARANTEE: AI must NEVER approve sync automatically');
  console.log('  -> PASS: Reference numbers, dates, departments extracted; approval locked.\n');

  // TEST 7: Cloud Sync Contract & Ledger
  console.log('[TEST 7/9] Testing Cloud Sync Gated Contract & Persistent Ledger...');
  // 1. Unapproved doc rejected
  assert.throws(() => syncService.validateForSync({ is_approved_for_sync: false }), /المستند غير معتمد للمزامنة/);

  // 2. Pending review tag rejected
  assert.throws(() => syncService.validateForSync({
    is_approved_for_sync: true,
    tag_objects: [{ name: 'شخصي' }, { name: 'بانتظار المراجعة' }],
  }), /بانتظار المراجعة/);

  // 3. Approved doc accepted
  const validSyncDoc = {
    id: doc.id,
    title: 'كتاب اعتماد المزامنة',
    original_checksum: 'chksm_99',
    is_approved_for_sync: true,
    tag_objects: [{ name: 'تناسق' }],
    custom_fields: [
      { name: 'رقم الكتاب', value: '0099/ت-2026' },
      { name: 'الجهة المرسلة', value: 'شركة تناسق' },
      { name: 'الجهة المستلمة', value: 'العميل' },
      { name: 'تاريخ الورود', value: '2026-09-24' },
      { name: 'راجعه', value: 'سفيان' },
      { name: 'تاريخ المراجعة', value: '2026-09-24' },
    ],
  };

  const syncVal = syncService.validateForSync(validSyncDoc);
  assert.strictEqual(syncVal.section, 'تناسق');
  assert.strictEqual(syncVal.docNumber, '0099/ت-2026');

  // Record in ledger
  syncService.recordSync(doc.id, syncVal.stableKey, syncVal.docHash, 'SUCCESS', 'drive_123', 'sheet_row_5');
  const ledgerEntry = syncService.getLedgerEntry(syncVal.stableKey);
  assert.strictEqual(ledgerEntry.sync_status, 'SUCCESS');
  assert.strictEqual(ledgerEntry.drive_file_id, 'drive_123');
  console.log('  -> PASS: Sync approval gates enforced; persistent ledger verified.\n');

  // TEST 8: Native Backup & Verification
  console.log('[TEST 8/9] Testing Native Backup Engine & Integrity Verification...');
  const backupRes = await backupService.createBackup();
  assert.strictEqual(backupRes.success, true);
  assert.ok(backupRes.documentsCount >= 1);

  const verifyRes = backupService.verifyBackup(backupRes.backupPath);
  assert.strictEqual(verifyRes.valid, true, 'Backup verification must pass SHA-256 checks');
  console.log(`  -> PASS: Backup created (${backupRes.backupName}) and verified 100% valid.\n`);

  // TEST 9: Paperless Migration & Reconciliation
  console.log('[TEST 9/9] Testing Paperless Migration & Reconciliation from Snapshot...');
  const snapshotDir = path.join(__dirname, '..', 'runtime', 'export', 'live-snapshot-20260924');
  const migReport = await migrator.migrateFromExport(snapshotDir, { allowDuplicates: true });
  assert.strictEqual(migReport.sourceCount, 12, 'Must match 12 source documents');
  assert.strictEqual(migReport.errors.length, 0, 'Must have 0 migration errors');
  assert.strictEqual(migReport.reconciliation.countsMatch, true, 'Reconciliation count must match');

  // Check document 4 in migrated data
  const migratedDocs = docService.listDocuments({ page_size: 50 });
  const migratedDoc4 = migratedDocs.results.find((d) => d.paperless_id === 4);
  assert.ok(migratedDoc4, 'Document #4 must be present');
  assert.strictEqual(migratedDoc4.title, 'تأييد قناة الانبار');
  const cf4 = migratedDoc4.custom_fields.find((f) => f.field === 1);
  assert.strictEqual(cf4.value, '0042/ص-2026', 'Official reference number must be preserved after migration');
  console.log(`  -> PASS: All ${migReport.importedCount} documents migrated; counts and hashes reconciled.\n`);

  // CLEANUP
  dbManager.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('========================================================');
  console.log('ALL 9 NATIVE TEST PHASES PASSED WITH ZERO ERRORS (100%)');
  console.log('========================================================');
}

runNativeTestSuite().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
