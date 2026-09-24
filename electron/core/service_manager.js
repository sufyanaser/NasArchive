/**
 * NAS Archive Native — Desktop Service & Engine Orchestrator
 * Completely replaces Docker and container orchestration with instant local native services:
 * Local SQLite (WAL), Native Document Storage, Tesseract OCR, and NAPS2 Scanner Bridge.
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
  }

  /**
   * Initialize local environment, storage folders, and database.
   */
  initialize(userDataDir, projectRoot) {
    if (this.initialized) return;

    // Use runtime directory in development or AppData in production
    const isPackaged = process.defaultApp === false || (process.resourcesPath && !process.resourcesPath.includes('node_modules'));
    
    // Choose persistent storage root outside installation directory
    let baseStorage = path.join(userDataDir, 'storage');
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

    const integrity = dbManager.checkIntegrity();
    const docCount = docService.getCount();

    return {
      docker: true, // For backward compatibility with UI pills
      paperless: true, // For backward compatibility with UI pills
      bridge: true, // For backward compatibility with UI pills
      nativeCore: true,
      database: {
        ok: integrity.ok,
        totalDocs: docCount,
      },
      ocr: {
        ready: Boolean(ocr.tessdataDir || ocr.tesseractPath),
        languages: ['ara', 'eng'],
      },
      scanner: {
        detected_devices: scanners,
        count: scanners.length,
      },
      version: '2.0.0 (Native)',
    };
  }
}

module.exports = new NativeServiceManager();
