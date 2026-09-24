/**
 * NAS Archive — Native Backup and Restore Engine
 * Packages SQLite database, originals, archive PDFs, OCR text, and manifest
 * with SHA-256 integrity verification and safe isolated restore capability.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbManager = require('./db');
const storage = require('./storage');

class BackupService {
  /**
   * Create a full, verified backup package into a designated destination directory.
   */
  async createBackup(targetBackupDir = null) {
    const db = dbManager.getDb();
    const backupRoot = targetBackupDir || storage.dirs.backups;

    if (!fs.existsSync(backupRoot)) {
      fs.mkdirSync(backupRoot, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const backupFolderName = `nas_backup_${timestamp}`;
    const backupDir = path.join(backupRoot, backupFolderName);
    fs.mkdirSync(backupDir, { recursive: true });

    const originalsDir = path.join(backupDir, 'originals');
    const archiveDir = path.join(backupDir, 'archive');
    const ocrDir = path.join(backupDir, 'ocr');
    fs.mkdirSync(originalsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(ocrDir, { recursive: true });

    // 1. Checkpoint WAL and copy SQLite database
    const dbBackupPath = path.join(backupDir, 'database.sqlite');
    dbManager.backup(dbBackupPath);

    // 2. Fetch all document records from DB
    const documents = db.prepare('SELECT * FROM documents').all();
    const tags = db.prepare('SELECT * FROM tags').all();
    const docTags = db.prepare('SELECT * FROM document_tags').all();
    const customFields = db.prepare('SELECT * FROM custom_fields').all();
    const docCustomFields = db.prepare('SELECT * FROM document_custom_fields').all();
    const docTypes = db.prepare('SELECT * FROM document_types').all();
    const correspondents = db.prepare('SELECT * FROM correspondents').all();
    const syncLedger = db.prepare('SELECT * FROM sync_ledger').all();

    const manifestFiles = [];

    // Helper to copy file and calculate hash
    const copyAndRecord = (srcPath, destFolder, category) => {
      if (srcPath && fs.existsSync(srcPath)) {
        const baseName = path.basename(srcPath);
        const destPath = path.join(destFolder, baseName);
        fs.copyFileSync(srcPath, destPath);
        const hash = storage.computeFileHash(destPath);
        const stat = fs.statSync(destPath);
        manifestFiles.push({
          category,
          originalPath: srcPath,
          backupRelativePath: `${category}/${baseName}`,
          checksum: hash,
          size: stat.size,
        });
      }
    };

    // 3. Copy files for each document
    for (const doc of documents) {
      if (doc.original_file_path) {
        copyAndRecord(doc.original_file_path, originalsDir, 'originals');
      }
      if (doc.archive_file_path) {
        copyAndRecord(doc.archive_file_path, archiveDir, 'archive');
      }
      // OCR text if exists
      const prefix = String(doc.id).padStart(7, '0');
      const ocrPath = path.join(storage.dirs.ocr, `${prefix}_ocr.txt`);
      if (fs.existsSync(ocrPath)) {
        copyAndRecord(ocrPath, ocrDir, 'ocr');
      }
    }

    // Database checksum
    const dbHash = storage.computeFileHash(dbBackupPath);
    const dbStat = fs.statSync(dbBackupPath);

    // 4. Build comprehensive Manifest
    const manifest = {
      version: '2.0.0',
      system: 'NAS Archive Native',
      createdAt: new Date().toISOString(),
      database: {
        checksum: dbHash,
        size: dbStat.size,
        tables: {
          documentsCount: documents.length,
          tagsCount: tags.length,
          docTypesCount: docTypes.length,
          customFieldsCount: customFields.length,
          syncLedgerCount: syncLedger.length,
        },
      },
      files: manifestFiles,
      dataDump: {
        documents,
        tags,
        docTags,
        customFields,
        docCustomFields,
        docTypes,
        correspondents,
        syncLedger,
      },
    };

    const manifestPath = path.join(backupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return {
      success: true,
      backupPath: backupDir,
      backupName: backupFolderName,
      documentsCount: documents.length,
      filesCount: manifestFiles.length,
      dbChecksum: dbHash,
    };
  }

  /**
   * Verify backup integrity without restoring.
   */
  verifyBackup(backupDir) {
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { valid: false, error: 'ملف manifest.json غير موجود داخل مجلد النسخة الاحتياطية.' };
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      return { valid: false, error: 'تعذر قراءة ملف manifest.json (تنسيق غير صالح).' };
    }

    // Verify DB file
    const dbPath = path.join(backupDir, 'database.sqlite');
    if (!fs.existsSync(dbPath)) {
      return { valid: false, error: 'ملف database.sqlite مفقود من النسخة الاحتياطية.' };
    }
    const currentDbHash = storage.computeFileHash(dbPath);
    if (currentDbHash !== manifest.database.checksum) {
      return { valid: false, error: 'تطابق بصمة قاعدة البيانات SHA-256 فشل.' };
    }

    // Verify each file
    let corruptCount = 0;
    for (const f of manifest.files || []) {
      const fullPath = path.join(backupDir, f.backupRelativePath);
      if (!fs.existsSync(fullPath)) {
        corruptCount++;
        continue;
      }
      const hash = storage.computeFileHash(fullPath);
      if (hash !== f.checksum) {
        corruptCount++;
      }
    }

    if (corruptCount > 0) {
      return { valid: false, error: `تم اكتشاف ${corruptCount} ملفات تالفة أو مفقودة في النسخة الاحتياطية.` };
    }

    return {
      valid: true,
      documentsCount: manifest.database.tables.documentsCount,
      filesCount: (manifest.files || []).length,
      createdAt: manifest.createdAt,
    };
  }

  /**
   * Restore from backup with isolated validation.
   */
  async restoreBackup(backupDir, confirmDestructive = false) {
    if (!confirmDestructive) {
      throw new Error('عملية الاستعادة تتطلب تأكيداً صريحاً (confirmDestructive = true).');
    }

    const verification = this.verifyBackup(backupDir);
    if (!verification.valid) {
      throw new Error(`فشل التحقق من صحة النسخة الاحتياطية: ${verification.error}`);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf-8'));

    // Copy restored database into active location
    const activeDbPath = dbManager.dbPath;
    dbManager.close();

    fs.copyFileSync(path.join(backupDir, 'database.sqlite'), activeDbPath);
    dbManager.initialize(activeDbPath);

    // Copy files back to active storage
    for (const f of manifest.files || []) {
      const srcPath = path.join(backupDir, f.backupRelativePath);
      let targetFolder = storage.dirs.originals;
      if (f.category === 'archive') targetFolder = storage.dirs.archive;
      if (f.category === 'ocr') targetFolder = storage.dirs.ocr;

      const targetPath = path.join(targetFolder, path.basename(srcPath));
      fs.copyFileSync(srcPath, targetPath);
    }

    return {
      success: true,
      documentsCount: verification.documentsCount,
      restoredAt: new Date().toISOString(),
    };
  }
}

module.exports = new BackupService();
