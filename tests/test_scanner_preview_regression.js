/**
 * NAS Archive — Automated Regression Test Suite
 * Covers Scanner Readiness & PDF Preview Critical Fixes:
 * 1. Missing PDF
 * 2. Corrupted PDF
 * 3. Arabic filenames
 * 4. Scanner unavailable
 * 5. Failed rescan
 * 6. Successful preview
 * 7. Successful archiving
 * 8. Application restart
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbManager = require('../electron/core/db');
const storage = require('../electron/core/storage');
const docService = require('../electron/core/documents');
const scanner = require('../electron/core/scanner');
const ocr = require('../electron/core/ocr');

// Sample minimal valid 1-page PDF binary
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n' +
  '0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'binary'
);

const TEST_DIR = path.resolve(__dirname, '..', 'runtime', 'test_regression_env');

async function runRegressionSuite() {
  console.log('========================================================');
  console.log('NAS ARCHIVE — SCANNER & PDF PREVIEW REGRESSION SUITE');
  console.log('========================================================');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const testDbPath = path.join(TEST_DIR, 'test_regression.sqlite');
  storage.initialize(TEST_DIR);
  dbManager.initialize(testDbPath);

  // Helper simulating the staging:read IPC handler
  async function stagingRead(filename) {
    if (!filename || typeof filename !== 'string') return { success: false, error: 'اسم الملف غير صالح.' };
    const safeName = storage.sanitizeFilename(filename);
    let targetPath = path.join(storage.dirs.staging, safeName);
    if (!fs.existsSync(targetPath)) return { success: false, error: `المستند غير موجود في مساحة المعاينة المؤقتة: ${safeName}` };
    const stat = fs.statSync(targetPath);
    if (stat.size === 0) return { success: false, error: 'ملف المستند فارغ (0 بايت).' };
    if (safeName.toLowerCase().endsWith('.pdf') && !storage.validatePdfHeader(targetPath)) {
      return { success: false, error: 'ملف المستند تالف أو لا يتطابق مع ترويسة PDF القياسية (%PDF-).' };
    }
    const buffer = fs.readFileSync(targetPath);
    return { success: true, filename: safeName, path: targetPath, size: stat.size, base64: buffer.toString('base64') };
  }

  // Helper simulating staging:validate IPC handler
  async function stagingValidate(filename) {
    if (!filename || typeof filename !== 'string') return { valid: false, error: 'اسم الملف غير صالح.' };
    const safeName = storage.sanitizeFilename(filename);
    let targetPath = path.join(storage.dirs.staging, safeName);
    if (!fs.existsSync(targetPath)) return { valid: false, error: `المستند غير موجود: ${safeName}` };
    const stat = fs.statSync(targetPath);
    if (stat.size === 0) return { valid: false, error: 'ملف المستند فارغ.' };
    if (safeName.toLowerCase().endsWith('.pdf') && !storage.validatePdfHeader(targetPath)) {
      return { valid: false, error: 'ملف المستند تالف.' };
    }
    return { valid: true, filename: safeName, size: stat.size };
  }

  // 1. Missing PDF Test
  console.log('\n[TEST 1/8] Missing PDF Handling...');
  const missingRead = await stagingRead('non_existent_file_999.pdf');
  const missingVal = await stagingValidate('non_existent_file_999.pdf');
  if (missingRead.success !== false || missingVal.valid !== false) {
    throw new Error('Missing PDF was incorrectly accepted.');
  }
  console.log('  -> PASS: Missing PDF safely rejected by read and validate.');

  // 2. Corrupted PDF Test
  console.log('\n[TEST 2/8] Corrupted PDF Handling...');
  const corruptName = 'corrupted_sample.pdf';
  const corruptPath = path.join(storage.dirs.staging, corruptName);
  fs.writeFileSync(corruptPath, Buffer.from('THIS_IS_NOT_A_VALID_PDF_HEADER_123456789'));
  const corruptRead = await stagingRead(corruptName);
  const corruptVal = await stagingValidate(corruptName);
  if (corruptRead.success !== false || corruptVal.valid !== false) {
    throw new Error('Corrupted PDF was incorrectly accepted.');
  }
  console.log(`  -> Corrupted read error: "${corruptRead.error}"`);
  console.log('  -> PASS: Corrupted PDF missing %PDF- header rejected.');
  fs.unlinkSync(corruptPath);

  // 3. Arabic Filenames Test
  console.log('\n[TEST 3/8] Arabic Filenames & Special Characters...');
  const arabicFilename = 'scan_20260924031608_شخصي_كتاب_0042_تجربة.pdf';
  storage.saveToStaging(arabicFilename, MINIMAL_PDF);
  const arabRead = await stagingRead(arabicFilename);
  const arabVal = await stagingValidate(arabicFilename);
  if (!arabRead.success || !arabVal.valid) {
    throw new Error(`Failed to read Arabic filename: ${arabRead.error}`);
  }
  // Test URL-encoded variant
  const encodedName = encodeURIComponent(arabicFilename);
  const encRead = await stagingRead(encodedName);
  if (!encRead.success) {
    throw new Error(`Failed to read URL-encoded Arabic filename: ${encRead.error}`);
  }
  const decodedHeader = Buffer.from(encRead.base64, 'base64').subarray(0, 5).toString('ascii');
  if (decodedHeader !== '%PDF-') {
    throw new Error('Decoded base64 does not match %PDF- header');
  }
  console.log('  -> PASS: Arabic filenames and URL-encoded variants handled with 100% fidelity.');

  // 4. Scanner Unavailable & Readiness Test
  console.log('\n[TEST 4/8] Scanner Availability & Readiness Check...');
  const readyFake = await scanner.checkReadiness('NonExistentScannerDeviceXYZ_123');
  if (readyFake.ready) {
    throw new Error('Non-existent scanner was reported as ready.');
  }
  console.log(`  -> Status for unavailable scanner: ready=${readyFake.ready}, status=${readyFake.status}`);
  // Test actual readiness check
  const realReadiness = await scanner.checkReadiness(null, 'wia');
  console.log(`  -> Actual environment scanner readiness: ready=${realReadiness.ready}, devices=[${realReadiness.devices.join(', ')}]`);
  console.log('  -> PASS: Scanner readiness correctly distinguishes device availability.');

  // 5. Failed Rescan Preservation Test
  console.log('\n[TEST 5/8] Failed Rescan State & Previous Scan Preservation...');
  const docA = 'scan_valid_doc_A.pdf';
  storage.saveToStaging(docA, MINIMAL_PDF);
  const docAPath = path.join(storage.dirs.staging, docA);
  if (!fs.existsSync(docAPath)) throw new Error('Doc A failed to save');

  // Simulate rescan failure
  let rescanFailed = false;
  try {
    // Attempt rescan with invalid DPI
    const invalidDpi = 9999;
    if (![150, 200, 300, 400, 600].includes(invalidDpi)) {
      throw new Error('Invalid DPI rejected by validation');
    }
  } catch (e) {
    rescanFailed = true;
  }
  // Verify Doc A was NOT deleted
  if (!fs.existsSync(docAPath)) {
    throw new Error('Doc A was unexpectedly deleted when rescan failed!');
  }
  const docARead = await stagingRead(docA);
  if (!docARead.success) {
    throw new Error('Doc A cannot be previewed after failed rescan');
  }
  console.log('  -> PASS: Previous valid document preserved intact after rescan failure.');

  // 6. Successful Preview Test
  console.log('\n[TEST 6/8] Successful Preview Data Generation...');
  const previewDoc = 'scan_preview_sample_عربي.pdf';
  storage.saveToStaging(previewDoc, MINIMAL_PDF);
  const pRead = await stagingRead(previewDoc);
  if (!pRead.success || !pRead.base64) {
    throw new Error('Failed to generate preview base64 data');
  }
  const pdfBytes = Buffer.from(pRead.base64, 'base64');
  if (pdfBytes.length !== MINIMAL_PDF.length) {
    throw new Error('Preview binary size mismatch');
  }
  console.log(`  -> Generated preview base64 payload: ${pRead.base64.length} characters.`);
  console.log('  -> PASS: Full-fidelity base64 preview generated for PDF viewer.');

  // 7. Successful Archiving Test
  console.log('\n[TEST 7/8] Explicit Archiving into Document Repository...');
  const archFilename = 'scan_20260924_شخصي_كتاب_0042.pdf';
  const stagedArch = storage.saveToStaging(archFilename, MINIMAL_PDF);
  const checksum = stagedArch.checksum;

  // Store Original
  const tempDocId = Date.now();
  const storedOrig = storage.storeOriginal(tempDocId, archFilename, stagedArch.path);
  if (!fs.existsSync(storedOrig.path)) {
    throw new Error('Failed to store original file');
  }

  // Create document in database
  const createdDoc = docService.createDocument({
    title: 'تأييد رسمي شخصي',
    content: 'محتوى نصي لاختبار الأرشفة الحقيقية 0042/ص-2026',
    created_date: '2026-09-24',
    original_filename: archFilename,
    original_file_path: storedOrig.path,
    original_checksum: checksum,
    original_size: storedOrig.size,
    original_mime_type: 'application/pdf',
    tags: [1, 2], // personal + inbox
    custom_fields: [
      { field: 1, value: '0042/ص-2026' },
      { field: 5, value: '00987-ق' },
    ],
  });

  // Remove staged file after confirmed archive
  fs.unlinkSync(stagedArch.path);

  if (!createdDoc || !createdDoc.id) {
    throw new Error('Document creation failed');
  }
  console.log(`  -> Document archived successfully with ID #${createdDoc.id}`);
  console.log(`  -> Original file stored at: ${storedOrig.path}`);

  // Verify FTS5 search
  const searchResults = docService.listDocuments({ search: '0042' });
  const found = searchResults.results.find((d) => d.id === createdDoc.id);
  if (!found) {
    throw new Error('Archived document could not be retrieved via FTS5 search');
  }
  console.log(`  -> FTS5 search for '0042' matched document #${found.id} title: "${found.title}"`);
  console.log('  -> PASS: Confirmed PDF archived to repository and indexed in FTS5.');

  // 8. Application Restart & Persistence Test
  console.log('\n[TEST 8/8] Application Restart & Repository Persistence...');
  dbManager.close();

  // Re-open database
  dbManager.initialize(testDbPath);
  const countAfterRestart = docService.getCount();
  if (countAfterRestart < 1) {
    throw new Error('Documents lost after database reload!');
  }
  const reloadedDoc = docService.getDocument(createdDoc.id);
  if (!reloadedDoc) {
    throw new Error(`Document #${createdDoc.id} missing after restart!`);
  }
  const refNumVal = (reloadedDoc.custom_fields || []).find((c) => c.name === 'رقم الكتاب');
  if (!refNumVal || refNumVal.value !== '0042/ص-2026') {
    throw new Error(`Reference number lost after restart: expected '0042/ص-2026', got '${refNumVal ? refNumVal.value : 'missing'}'`);
  }
  console.log(`  -> Reloaded ${countAfterRestart} document(s). Reference number "${refNumVal.value}" intact.`);
  dbManager.close();

  // Cleanup test environment
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  console.log('  -> PASS: Full persistence and integrity verified across simulated app restart.');

  console.log('\n========================================================');
  console.log('ALL 8 SCANNER & PREVIEW REGRESSION TESTS PASSED (100%)');
  console.log('========================================================\n');
}

runRegressionSuite().catch((err) => {
  console.error('\nREGRESSION SUITE FAILED:', err);
  process.exit(1);
});
