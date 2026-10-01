/**
 * NAS Archive Native — Desktop Service & Engine Orchestrator
 * Local desktop orchestration for SQLite (WAL), native document storage,
 * Tesseract OCR, and the NAPS2/WIA scanner bridge.
 */
const path = require('path');
const fs = require('fs');
const dbManager = require('./db');
const storage = require('./storage');
const docService = require('./documents');
const scanner = require('./scanner');
const ocr = require('./ocr');
const migrator = require('./migrator');

class NativeServiceManager {
  constructor() {
    this.initialized = false;
    this.storagePath = null;
    this.dbPath = null;
    this.userDataDir = null;
    this.projectRoot = null;
  }

  /**
   * Initialize local environment, storage folders, and database.
   */
  initialize(userDataDir, projectRoot) {
    if (this.initialized) return;
    this.userDataDir = userDataDir;
    this.projectRoot = projectRoot;

    // Use runtime directory in development or AppData in production
    const isPackaged = process.defaultApp === false || (process.resourcesPath && !process.resourcesPath.includes('node_modules'));
    
    // Choose persistent storage root outside installation directory
    const configuredStorage = this._loadConfiguredStoragePath(userDataDir);
    let baseStorage = configuredStorage || path.join(userDataDir, 'storage');
    // In repo dev mode, check if runtime exists
    if (!isPackaged && projectRoot && fs.existsSync(path.join(projectRoot, 'runtime'))) {
      baseStorage = path.join(projectRoot, 'runtime', 'storage');
    }

    this.storagePath = baseStorage;
    this.dbPath = path.join(baseStorage, 'nas_archive.sqlite');

    // Initialize document storage directory tree
    storage.initialize(baseStorage);

    // Initialize SQLite database with WAL and migrations
    dbManager.initialize(this.dbPath);

    // Auto-migrate from existing snapshot if fresh database and snapshot exists
    const docCount = docService.getCount();
    if (docCount === 0) {
      const snapshotDir = path.join(projectRoot || '.', 'runtime', 'export', 'live-snapshot-20260924');
      if (fs.existsSync(snapshotDir) && fs.existsSync(path.join(snapshotDir, 'manifest.json'))) {
        try {
          console.log('[NativeServiceManager] First-time startup: auto-migrating existing documents from Paperless snapshot...');
          migrator.migrateFromExport(snapshotDir, { allowDuplicates: false });
          console.log('[NativeServiceManager] Auto-migration complete. Total docs:', docService.getCount());
        } catch (migErr) {
          console.warn('[NativeServiceManager] Auto-migration warning:', migErr.message);
        }
      }
    }

    this.initialized = true;
  }

  _loadConfiguredStoragePath(userDataDir) {
    try {
      const prefsPath = path.join(userDataDir, 'nas_preferences.json');
      if (!fs.existsSync(prefsPath)) return null;
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      if (!prefs.archiveStoragePath || typeof prefs.archiveStoragePath !== 'string') return null;
      return path.resolve(prefs.archiveStoragePath);
    } catch (e) {
      return null;
    }
  }

  validateStoragePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      return { ok: false, error: 'لم يتم تحديد مجلد صالح للأرشفة.' };
    }

    try {
      const resolved = path.resolve(targetPath);
      fs.mkdirSync(resolved, { recursive: true });
      const probe = path.join(resolved, `.nas_archive_write_test_${Date.now()}.tmp`);
      fs.writeFileSync(probe, 'ok', 'utf-8');
      fs.unlinkSync(probe);
      return { ok: true, path: resolved };
    } catch (e) {
      return { ok: false, path: targetPath, error: e.message };
    }
  }

  /**
   * Fast, native startup sequence with progress notification.
   */
  async runStartupSequence(progressCallback) {
    const notify = (step, title, subtitle, error = null) => {
      if (progressCallback) progressCallback({ step, totalSteps: 4, title, subtitle, error });
    };

    // 1. Native Database & Storage
    notify(1, 'تشغيل قاعدة البيانات المحلية', 'فحص محرك SQLite وفهرس البحث السريع FTS5...');
    const integrity = dbManager.checkIntegrity();
    if (!integrity.ok) {
      notify(1, 'خطأ في قاعدة البيانات', 'تعذر التحقق من سلامة قاعدة البيانات المحلية.', 'DB_CORRUPTED');
      return { success: false, code: 'DB_CORRUPTED' };
    }

    // 2. Document Repository
    notify(2, 'فحص مخزن الوثائق والأرشيف', 'التحقق من سلامة المجلدات والملفات الأصلية...');
    const docCount = docService.getCount();

    // 3. OCR Engine
    notify(3, 'تهيئة محرك التعرف الضوئي (OCR)', 'تجهيز حزم التعرف على النصوص باللغتين العربية والإنجليزية...');
    const ocrReady = Boolean(ocr.tessdataDir || ocr.tesseractPath);

    // 4. Physical Scanner Discovery
    notify(4, 'فحص الماسح الضوئي وأجهزة المسح', 'البحث عن أجهزة المسح المتصلة (WIA/TWAIN)...');
    let scanners = [];
    try {
      const scanRes = await scanner.listDevices('wia');
      scanners = scanRes.devices || [];
    } catch (e) {
      scanners = [];
    }

    const scannerMsg = scanners.length > 0
      ? `تم التعرف على الماسح: ${scanners[0]}`
      : 'جاهز للمسح واستيراد الوثائق (لم يُكتشف ماسح فيزيائي حالياً).';

    notify(4, 'جاهز للعمل!', scannerMsg);
    return {
      success: true,
      scanners,
      totalDocuments: docCount,
      ocrReady,
    };
  }

  /**
   * Health snapshot for UI settings / dashboard.
   */
  async getHealthSnapshot() {
    let scanners = [];
    try {
      const scanRes = await scanner.listDevices('wia');
      scanners = scanRes.devices || [];
    } catch (e) {
      scanners = [];
    }

    let integrity = { ok: false, error: 'لم تتم تهيئة قاعدة البيانات بعد.' };
    let docCount = 0;
    try {
      integrity = dbManager.checkIntegrity();
      docCount = docService.getCount();
    } catch (e) {
      integrity = { ok: false, error: e.message };
    }
    const storageCheck = this.storagePath
      ? this.validateStoragePath(this.storagePath)
      : { ok: false, error: 'لم يتم تحديد مسار التخزين.' };
    const coreOk = Boolean(this.storagePath && storageCheck.ok);

    return {
      nativeCore: {
        ok: coreOk,
        initialized: this.initialized,
        status: coreOk ? 'READY' : 'NEEDS_ATTENTION',
        storagePath: this.storagePath,
        message: coreOk ? 'النواة المحلية جاهزة' : (storageCheck.error || 'النواة المحلية تحتاج فحصاً'),
      },
      database: {
        ok: integrity.ok,
        totalDocs: docCount,
        path: this.dbPath,
        error: integrity.error || null,
      },
      storage: {
        ok: storageCheck.ok,
        path: this.storagePath,
        error: storageCheck.error || null,
      },
      ocr: {
        ready: Boolean(ocr.tessdataDir || ocr.tesseractPath),
        languages: ['ara', 'eng'],
      },
      scanner: {
        detected_devices: scanners,
        count: scanners.length,
      },
      architecture: 'native',
    };
  }
}

module.exports = new NativeServiceManager();
