/**
 * NAS Archive — Secure IPC Handlers
 * Registers all validated IPC communication channels between Electron Renderer and Native Core.
 * Completely eliminates any localhost HTTP servers or external ports.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbManager = require('./db');
const storage = require('./storage');
const docService = require('./documents');
const scanner = require('./scanner');
const ocr = require('./ocr');
const aiAnalyzer = require('./ai_analyzer');
const syncService = require('./sync_ledger');
const backupService = require('./backup');
const migrator = require('./migrator');
const classification = require('./classification');
const archiveService = require('./archive_service');

function setupNativeIpcHandlers(appDataDir) {
  // 1. System & Engine Health Status
  ipcMain.handle('system:status', async () => {
    try {
      const integrity = dbManager.checkIntegrity();
      const totalDocs = docService.getCount();
      const scannerRes = await scanner.listDevices('wia');
      const readiness = await scanner.checkReadiness(null, 'wia');

      return {
        success: true,
        engine: 'NAS Archive Native v2.0',
        dockerRequired: false,
        wslRequired: false,
        database: {
          path: dbManager.dbPath,
          integrity: integrity.ok,
          totalDocuments: totalDocs,
        },
        scanner: {
          detected: scannerRes.devices.length > 0,
          devices: scannerRes.devices,
          detected_devices: scannerRes.devices,
          ready: readiness.ready,
          status: readiness.status,
          activeDevice: readiness.activeDevice,
        },
        ocr: {
          tessdata: Boolean(ocr.tessdataDir),
          tesseract: Boolean(ocr.tesseractPath),
        },
        storage: {
          base: storage.baseDir,
          originals: storage.dirs.originals,
          archive: storage.dirs.archive,
          staging: storage.dirs.staging,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 2. Documents CRUD & Filtering
  ipcMain.handle('documents:list', async (event, params = {}) => {
    try {
      return docService.listDocuments(params);
    } catch (err) {
      return { count: 0, results: [], error: err.message };
    }
  });

  ipcMain.handle('documents:get', async (event, id) => {
    try {
      const doc = docService.getDocument(id);
      if (!doc) throw new Error(`Document #${id} not found.`);
      return { success: true, document: doc };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:update', async (event, { id, patch }) => {
    try {
      const updated = docService.updateDocument(id, patch);
      return { success: true, document: updated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:delete', async (event, args) => {
    try {
      const id = typeof args === 'object' && args !== null ? args.id : args;
      const permanent = typeof args === 'object' && args !== null ? Boolean(args.permanent) : false;
      const ok = docService.deleteDocument(id, permanent);
      archiveService.log('INFO', 'Documents', `تم ${permanent ? 'حذف الوثيقة نهائياً' : 'نقل الوثيقة لسلة المهملات'} #${id}`);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:restore', async (event, id) => {
    try {
      const ok = docService.restoreDocument(id);
      archiveService.log('INFO', 'Documents', `تمت استعادة الوثيقة #${id} من سلة المهملات`);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Trash Lifecycle
  ipcMain.handle('trash:list', async (event, params = {}) => {
    try {
      return docService.listTrash(params);
    } catch (err) {
      return { count: 0, results: [], error: err.message };
    }
  });

  ipcMain.handle('trash:purge', async () => {
    try {
      const count = docService.purgeTrash();
      archiveService.log('INFO', 'Documents', `تم تفريغ سلة المهملات بالكامل (${count} وثيقة)`);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Bulk Operations
  ipcMain.handle('documents:bulk-delete', async (event, { ids, permanent = false }) => {
    try {
      const count = docService.bulkDelete(ids, permanent);
      archiveService.log('INFO', 'Documents', `إجراء جماعي: ${permanent ? 'حذف نهائي' : 'نقل لسلة المهملات'} لـ ${count} وثيقة`);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-restore', async (event, ids) => {
    try {
      const count = docService.bulkRestore(ids);
      archiveService.log('INFO', 'Documents', `إجراء جماعي: استعادة ${count} وثيقة من المهملات`);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-add-tag', async (event, { ids, tagId }) => {
    try {
      const count = docService.bulkAddTag(ids, tagId);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-remove-tag', async (event, { ids, tagId }) => {
    try {
      const count = docService.bulkRemoveTag(ids, tagId);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-approve', async (event, ids) => {
    try {
      const count = docService.bulkApprove(ids);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-set-type', async (event, { ids, typeId }) => {
    try {
      const count = docService.bulkSetType(ids, typeId);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:bulk-set-correspondent', async (event, { ids, correspondentId }) => {
    try {
      const count = docService.bulkSetCorrespondent(ids, correspondentId);
      return { success: true, count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:read-binary', async (event, id) => {
    try {
      const doc = docService.getDocument(id);
      if (!doc) throw new Error(`Document #${id} not found.`);

      const targetPath = doc.archive_file_path && fs.existsSync(doc.archive_file_path)
        ? doc.archive_file_path
        : doc.original_file_path;

      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error('ملف المستند غير موجود على القرص.');
      }

      const buffer = fs.readFileSync(targetPath);
      return {
        success: true,
        base64: buffer.toString('base64'),
        filename: path.basename(targetPath),
        size: buffer.length,
        mimeType: doc.original_mime_type,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:export-file', async (event, id) => {
    try {
      const doc = docService.getDocument(id);
      if (!doc) throw new Error(`Document #${id} not found.`);

      const targetPath = doc.archive_file_path && fs.existsSync(doc.archive_file_path)
        ? doc.archive_file_path
        : doc.original_file_path;

      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error('ملف المستند غير موجود على القرص.');
      }

      const { dialog } = require('electron');
      const ext = path.extname(targetPath) || '.pdf';
      const res = await dialog.showSaveDialog({
        title: 'تنزيل أو حفظ نسخة من المستند',
        defaultPath: doc.title + ext,
      });

      if (!res.canceled && res.filePath) {
        fs.copyFileSync(targetPath, res.filePath);
        return { success: true, savedPath: res.filePath };
      }
      return { success: false, canceled: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Classification CRUD
  ipcMain.handle('classification:tags:list', async () => classification.listTags());
  ipcMain.handle('classification:tags:create', async (event, data) => classification.createTag(data));
  ipcMain.handle('classification:tags:update', async (event, { id, patch }) => classification.updateTag(id, patch));
  ipcMain.handle('classification:tags:delete', async (event, id) => ({ success: classification.deleteTag(id) }));

  ipcMain.handle('classification:correspondents:list', async () => classification.listCorrespondents());
  ipcMain.handle('classification:correspondents:create', async (event, data) => classification.createCorrespondent(data));
  ipcMain.handle('classification:correspondents:update', async (event, { id, patch }) => classification.updateCorrespondent(id, patch));
  ipcMain.handle('classification:correspondents:delete', async (event, id) => ({ success: classification.deleteCorrespondent(id) }));

  ipcMain.handle('classification:types:list', async () => classification.listDocumentTypes());
  ipcMain.handle('classification:types:create', async (event, data) => classification.createDocumentType(data));
  ipcMain.handle('classification:types:update', async (event, { id, patch }) => classification.updateDocumentType(id, patch));
  ipcMain.handle('classification:types:delete', async (event, id) => ({ success: classification.deleteDocumentType(id) }));

  ipcMain.handle('classification:storage-paths:list', async () => classification.listStoragePaths());
  ipcMain.handle('classification:storage-paths:create', async (event, data) => classification.createStoragePath(data));
  ipcMain.handle('classification:storage-paths:update', async (event, { id, patch }) => classification.updateStoragePath(id, patch));
  ipcMain.handle('classification:storage-paths:delete', async (event, id) => ({ success: classification.deleteStoragePath(id) }));

  ipcMain.handle('classification:custom-fields:list', async () => classification.listCustomFields());
  ipcMain.handle('classification:custom-fields:create', async (event, data) => classification.createCustomField(data));
  ipcMain.handle('classification:custom-fields:update', async (event, { id, patch }) => classification.updateCustomField(id, patch));
  ipcMain.handle('classification:custom-fields:delete', async (event, id) => ({ success: classification.deleteCustomField(id) }));

  // Backward-compatible metadata channels
  ipcMain.handle('documents:get-tags', async () => classification.listTags());
  ipcMain.handle('documents:get-types', async () => classification.listDocumentTypes());
  ipcMain.handle('documents:get-custom-fields', async () => classification.listCustomFields());
  ipcMain.handle('documents:get-correspondents', async () => classification.listCorrespondents());
  ipcMain.handle('documents:get-storage-paths', async () => classification.listStoragePaths());

  // Saved Views
  ipcMain.handle('saved-views:list', async () => archiveService.listSavedViews());
  ipcMain.handle('saved-views:get', async (event, id) => archiveService.getSavedView(id));
  ipcMain.handle('saved-views:create', async (event, data) => archiveService.createSavedView(data));
  ipcMain.handle('saved-views:update', async (event, { id, patch }) => archiveService.updateSavedView(id, patch));
  ipcMain.handle('saved-views:delete', async (event, id) => ({ success: archiveService.deleteSavedView(id) }));

  // Workflows
  ipcMain.handle('workflows:list', async () => archiveService.listWorkflows());
  ipcMain.handle('workflows:get', async (event, id) => archiveService.getWorkflow(id));
  ipcMain.handle('workflows:create', async (event, data) => archiveService.createWorkflow(data));
  ipcMain.handle('workflows:update', async (event, { id, patch }) => archiveService.updateWorkflow(id, patch));
  ipcMain.handle('workflows:delete', async (event, id) => ({ success: archiveService.deleteWorkflow(id) }));

  // Tasks & Logs
  ipcMain.handle('tasks:list', async (event, limit) => archiveService.listTasks(limit));
  ipcMain.handle('logs:list', async (event, filter) => archiveService.listLogs(filter));
  ipcMain.handle('logs:clear', async () => ({ success: archiveService.clearLogs() }));

  // Users
  ipcMain.handle('users:list', async () => archiveService.listUsers());
  ipcMain.handle('users:update', async (event, { id, patch }) => archiveService.updateUser(id, patch));

  ipcMain.handle('documents:check-duplicate', async (event, checksum) => {
    try {
      const dup = docService.checkDuplicate(checksum);
      return { isDuplicate: Boolean(dup), existing: dup };
    } catch (err) {
      return { isDuplicate: false, error: err.message };
    }
  });

  // 3. Document Staging & Ingestion
  ipcMain.handle('documents:import-stage', async (event, { filename, fileDataB64, section = 'شخصي' }) => {
    try {
      if (!filename || !fileDataB64) {
        throw new Error('بيانات الملف غير مكتملة.');
      }
      const buffer = Buffer.from(fileDataB64, 'base64');
      if (buffer.length === 0) {
        throw new Error('الملف فارغ (0 بايت).');
      }

      const staged = storage.saveToStaging(filename, buffer);
      const isPdf = staged.filename.toLowerCase().endsWith('.pdf');
      if (isPdf && !storage.validatePdfHeader(staged.path)) {
        storage.removeStaged(staged.filename);
        throw new Error('الملف لا يطابق بنية PDF الصحيحة (%PDF-).');
      }

      // Check duplicate
      const duplicate = docService.checkDuplicate(staged.checksum);

      return {
        success: true,
        filename: staged.filename,
        size: staged.size,
        checksum: staged.checksum,
        isDuplicate: Boolean(duplicate),
        duplicateMatch: duplicate,
        section,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('documents:discard-staged', async (event, filename) => {
    try {
      const ok = storage.removeStaged(filename);
      return { success: ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 4. Scanner Integration
  ipcMain.handle('scanner:devices', async (event, driver = 'wia') => {
    try {
      return await scanner.listDevices(driver);
    } catch (err) {
      return { driver, devices: [], error: err.message };
    }
  });

  ipcMain.handle('scanner:stage', async (event, options = {}) => {
    try {
      const res = await scanner.scanToStaging(options);
      const duplicate = docService.checkDuplicate(res.checksum);

      return {
        success: true,
        filename: res.filename,
        size: res.size,
        checksum: res.checksum,
        section: res.section,
        dpi: res.dpi,
        isDuplicate: Boolean(duplicate),
        duplicateMatch: duplicate,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('scanner:cancel', async () => {
    return { success: scanner.cancelScan() };
  });

  ipcMain.handle('scanner:readiness', async (event, { device, driver } = {}) => {
    try {
      const res = await scanner.checkReadiness(device, driver || 'wia');
      return { success: true, ...res };
    } catch (err) {
      return { success: false, ready: false, error: err.message };
    }
  });

  // 5. Staging Direct Access & PDF Preview Validation (Zero Network Exposure IPC)
  ipcMain.handle('staging:read', async (event, filename) => {
    try {
      if (!filename || typeof filename !== 'string') {
        return { success: false, error: 'اسم الملف غير صالح.' };
      }
      const safeName = storage.sanitizeFilename(filename);
      let targetPath = path.join(storage.dirs.staging, safeName);
      if (!fs.existsSync(targetPath)) {
        const alt = path.resolve('runtime', 'staging', safeName);
        if (fs.existsSync(alt)) targetPath = alt;
      }

      if (!fs.existsSync(targetPath)) {
        return { success: false, error: `المستند غير موجود في مساحة المعاينة المؤقتة: ${safeName}` };
      }

      const stat = fs.statSync(targetPath);
      if (stat.size === 0) {
        return { success: false, error: 'ملف المستند فارغ (0 بايت).' };
      }

      if (safeName.toLowerCase().endsWith('.pdf') && !storage.validatePdfHeader(targetPath)) {
        return { success: false, error: 'ملف المستند تالف أو لا يتطابق مع ترويسة PDF القياسية (%PDF-).' };
      }

      const buffer = fs.readFileSync(targetPath);
      return {
        success: true,
        filename: safeName,
        path: targetPath,
        size: stat.size,
        base64: buffer.toString('base64'),
      };
    } catch (err) {
      return { success: false, error: `فشل قراءة ملف المعاينة: ${err.message}` };
    }
  });

  ipcMain.handle('staging:validate', async (event, filename) => {
    try {
      if (!filename || typeof filename !== 'string') {
        return { valid: false, error: 'اسم الملف غير صالح.' };
      }
      const safeName = storage.sanitizeFilename(filename);
      let targetPath = path.join(storage.dirs.staging, safeName);
      if (!fs.existsSync(targetPath)) {
        const alt = path.resolve('runtime', 'staging', safeName);
        if (fs.existsSync(alt)) targetPath = alt;
      }

      if (!fs.existsSync(targetPath)) {
        return { valid: false, error: `المستند غير موجود في مساحة المعاينة المؤقتة: ${safeName}` };
      }

      const stat = fs.statSync(targetPath);
      if (stat.size === 0) {
        return { valid: false, error: 'ملف المستند فارغ (0 بايت).' };
      }

      if (safeName.toLowerCase().endsWith('.pdf') && !storage.validatePdfHeader(targetPath)) {
        return { valid: false, error: 'ملف المستند تالف أو لا يتطابق مع ترويسة PDF القياسية (%PDF-).' };
      }

      return { valid: true, filename: safeName, size: stat.size };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  });

  // 6. Stage B: Explicit Archive
  ipcMain.handle('archive:stage', async (event, { filename, section = 'شخصي', allowDuplicate = false, title = null }) => {
    try {
      if (!filename || typeof filename !== 'string') {
        throw new Error('اسم الملف غير محدد.');
      }
      const safeName = storage.sanitizeFilename(filename);
      let stagedPath = path.join(storage.dirs.staging, safeName);
      if (!fs.existsSync(stagedPath)) {
        const alt = path.resolve('runtime', 'staging', safeName);
        if (fs.existsSync(alt)) stagedPath = alt;
      }

      if (!fs.existsSync(stagedPath)) {
        throw new Error(`الملف المطلوب أرشفته غير موجود في مساحة المعاينة المؤقتة: ${safeName}`);
      }

      if (!storage.validatePdfHeader(stagedPath)) {
        throw new Error('ملف المستند المطلوب أرشفته تالف ولا يطابق بنية PDF القياسية (%PDF-).');
      }

      const checksum = storage.computeFileHash(stagedPath);
      const stat = fs.statSync(stagedPath);

      if (!allowDuplicate) {
        const dup = docService.checkDuplicate(checksum);
        if (dup) {
          return {
            success: false,
            status: 'DUPLICATE',
            message: `هذا المستند مطابق تماماً لوثيقة موجودة مسبقاً في الأرشيف (رقم #${dup.id}: ${dup.title}).`,
            existingId: dup.id,
          };
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const docTitle = title || path.basename(filename, path.extname(filename)).replace(/^scan_\d+_/, '');

      // Store Original file permanently
      const tempId = Date.now();
      const storedOrig = storage.storeOriginal(tempId, filename, stagedPath);

      // Run OCR & text extraction
      let ocrResult = { text: '', pageCount: 1, archivePdfPath: null };
      try {
        ocrResult = await ocr.processDocumentOcr(tempId, storedOrig.path, 'ara');
      } catch (ocrErr) {
        console.warn('OCR non-fatal warning:', ocrErr.message);
      }

      // Store Archive PDF if OCR produced one
      let storedArch = null;
      if (ocrResult.archivePdfPath && fs.existsSync(ocrResult.archivePdfPath)) {
        storedArch = storage.storeArchivedPdf(tempId, today, docTitle, ocrResult.archivePdfPath);
        try { fs.unlinkSync(ocrResult.archivePdfPath); } catch (e) {}
      }

      // Run AI Analyzer to extract suggested metadata
      const aiSuggestions = aiAnalyzer.analyze(ocrResult.text || docTitle, docTitle);

      // Map Section to Tag ID
      const allTags = docService.getTags().results;
      const deptTag = allTags.find((t) => t.name === section);
      const inboxTag = allTags.find((t) => t.is_inbox_tag === 1);

      const assignedTags = [];
      if (deptTag) assignedTags.push(deptTag.id);
      if (inboxTag) assignedTags.push(inboxTag.id); // Add inbox tag for review

      // Map AI suggested custom fields
      const customFieldValues = [];
      const allCfs = docService.getCustomFields().results;
      const getCfId = (name) => {
        const f = allCfs.find((c) => c.name === name);
        return f ? f.id : null;
      };

      if (aiSuggestions.doc_number_suggestion.value) {
        const id = getCfId('رقم الكتاب');
        if (id) customFieldValues.push({ field: id, value: aiSuggestions.doc_number_suggestion.value });
      }
      if (aiSuggestions.entry_number_suggestion.value) {
        const id = getCfId('رقم القيد');
        if (id) customFieldValues.push({ field: id, value: aiSuggestions.entry_number_suggestion.value });
      }
      if (aiSuggestions.doc_date_suggestion.value) {
        const id = getCfId('تاريخ الورود');
        if (id) customFieldValues.push({ field: id, value: aiSuggestions.doc_date_suggestion.value });
      }
      if (aiSuggestions.sender_suggestion.value) {
        const id = getCfId('الجهة المرسلة');
        if (id) customFieldValues.push({ field: id, value: aiSuggestions.sender_suggestion.value });
      }
      if (aiSuggestions.recipient_suggestion.value) {
        const id = getCfId('الجهة المستلمة');
        if (id) customFieldValues.push({ field: id, value: aiSuggestions.recipient_suggestion.value });
      }

      // Create Document in Database
      const newDoc = docService.createDocument({
        title: aiSuggestions.title_suggestion.value || docTitle,
        content: ocrResult.text || '',
        created_date: aiSuggestions.doc_date_suggestion.value || today,
        original_filename: filename,
        original_file_path: storedOrig.path,
        original_checksum: storedOrig.checksum,
        original_size: storedOrig.size,
        original_mime_type: storedOrig.mimeType,
        archive_filename: storedArch ? storedArch.filename : null,
        archive_file_path: storedArch ? storedArch.path : null,
        archive_checksum: storedArch ? storedArch.checksum : null,
        archive_size: storedArch ? storedArch.size : null,
        page_count: ocrResult.pageCount || 1,
        status: 'INBOX',
        tags: assignedTags,
        custom_fields: customFieldValues,
      });

      // Cleanup staged file
      storage.removeStaged(filename);

      return {
        success: true,
        status: 'SUCCESS',
        document: newDoc,
        aiSuggestions,
      };
    } catch (err) {
      return { success: false, status: 'FAILED', error: err.message };
    }
  });

  // 6. AI Analysis Direct Channel
  ipcMain.handle('ai:analyze', async (event, { text, title }) => {
    try {
      return { success: true, analysis: aiAnalyzer.analyze(text, title) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 7. Cloud Sync Channel
  ipcMain.handle('sync:validate', async (event, docId) => {
    try {
      const doc = docService.getDocument(docId);
      const validation = syncService.validateForSync(doc);
      return { success: true, validation };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:execute', async (event, { docId, dryRun = true }) => {
    try {
      const doc = docService.getDocument(docId);
      const res = await syncService.syncDocument(doc, dryRun);
      return { success: true, result: res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 8. Backup & Restore Channels
  ipcMain.handle('backup:create', async () => {
    try {
      const res = await backupService.createBackup();
      return { success: true, backup: res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:verify', async (event, backupDir) => {
    try {
      const res = backupService.verifyBackup(backupDir);
      return { success: true, result: res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('backup:restore', async (event, { backupDir, confirmDestructive }) => {
    try {
      const res = await backupService.restoreBackup(backupDir, confirmDestructive);
      return { success: true, result: res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 9. Migration Channels
  ipcMain.handle('migration:run', async (event, { exportDir, allowDuplicates = false }) => {
    try {
      const report = await migrator.migrateFromExport(exportDir, { allowDuplicates });
      return { success: true, report };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 10. Preferences Channels
  const prefsFile = path.join(appDataDir, 'nas_preferences.json');
  const getPrefs = () => {
    try {
      if (fs.existsSync(prefsFile)) return JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    } catch (e) {}
    return {
      theme: 'light',
      defaultSection: 'شخصي',
      defaultDpi: 300,
      defaultBitdepth: 'color',
      defaultSource: 'glass',
      autoDeskew: true,
    };
  };

  const safeRegister = (channel, handler) => {
    try {
      ipcMain.handle(channel, handler);
    } catch (e) {
      // already registered in main.js
    }
  };

  safeRegister('prefs:get', (event, key) => getPrefs()[key]);
  safeRegister('prefs:set', (event, key, val) => {
    try {
      const p = getPrefs();
      p[key] = val;
      fs.writeFileSync(prefsFile, JSON.stringify(p, null, 2), 'utf8');
      return true;
    } catch (e) { return false; }
  });
  safeRegister('prefs:get-all', () => getPrefs());
}

module.exports = {
  setupNativeIpcHandlers,
};
