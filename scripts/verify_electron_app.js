/**
 * Automated Electron Native Lifecycle & IPC Verification
 * Runs inside Electron runtime to verify full desktop application functionality.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const serviceManager = require('../electron/core/service_manager');
const dbManager = require('../electron/core/db');
const docService = require('../electron/core/documents');
const { setupNativeIpcHandlers } = require('../electron/core/ipc_handlers');

console.log('========================================================');
console.log('NAS ARCHIVE NATIVE — ELECTRON RUNTIME LIVE VERIFICATION');
console.log('========================================================');

app.whenReady().then(async () => {
  try {
    const userData = app.getPath('userData');
    const projectRoot = path.resolve(__dirname, '..');
    console.log('[1/5] Initializing Native Service Manager in Electron...');
    serviceManager.initialize(userData, projectRoot);
    setupNativeIpcHandlers(userData);

    console.log('[2/5] Running Native Startup Sequence...');
    const startupResult = await serviceManager.runStartupSequence((p) => {
      console.log(`  Step ${p.step}/${p.totalSteps}: ${p.title} - ${p.subtitle}`);
    });

    if (!startupResult.success) {
      throw new Error(`Startup failed: ${startupResult.code}`);
    }
    console.log('  -> Startup sequence completed successfully.');

    console.log('[3/5] Verifying Document Retrieval & Preservation...');
    const listRes = docService.listDocuments({ page: 1, page_size: 50 });
    console.log(`  -> Retrieved ${listRes.results.length} documents (total count: ${listRes.count}) from native SQLite.`);
    if (listRes.results.length !== 12) {
      throw new Error(`Expected 12 documents, but found ${listRes.results.length}`);
    }

    const doc4 = docService.getDocument(4);
    if (!doc4) throw new Error('Document ID 4 not found');
    console.log(`  -> Document 4 Title: "${doc4.title}"`);
    console.log(`  -> Document 4 Custom Fields:`, JSON.stringify(doc4.custom_fields, null, 2));

    const refNum = (doc4.custom_fields || []).find(cf => cf.name === 'رقم الكتاب');
    if (!refNum || refNum.value !== '0042/ص-2026') {
      throw new Error(`Reference number mismatch: expected '0042/ص-2026', got '${refNum ? refNum.value : 'missing'}'`);
    }
    console.log('  -> Reference number "0042/ص-2026" preserved intact with leading zeros.');

    console.log('[4/5] Verifying FTS5 Arabic Search in Electron runtime...');
    const searchRes = docService.listDocuments({ search: 'الانبار' });
    console.log(`  -> Search for "الانبار" returned ${searchRes.results.length} document(s).`);
    if (searchRes.results.length === 0) {
      throw new Error('Arabic search failed to find matching document');
    }

    console.log('[5/5] Testing BrowserWindow creation & DOM load...');
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, '..', 'electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
    console.log('  -> Main window loaded index.html successfully.');
    win.destroy();

    console.log('========================================================');
    console.log('ALL ELECTRON RUNTIME LIVE VERIFICATIONS PASSED (100%)');
    console.log('========================================================');
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('VERIFICATION FAILED:', err);
    app.quit();
    process.exit(1);
  }
});
