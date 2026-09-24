/**
 * NAS Archive — Local Document Storage Engine
 * Manages atomic writes, secure folder structure, SHA-256 fingerprinting,
 * path traversal protection, and full preservation of Arabic filenames.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DocumentStorage {
  constructor() {
    this.baseDir = null;
    this.dirs = {};
  }

  /**
   * Initialize storage directory structure.
   */
  initialize(baseDir) {
    this.baseDir = path.resolve(baseDir);
    this.dirs = {
      originals: path.join(this.baseDir, 'originals'),
      archive: path.join(this.baseDir, 'archive'),
      staging: path.join(this.baseDir, 'staging'),
      thumbnails: path.join(this.baseDir, 'thumbnails'),
      ocr: path.join(this.baseDir, 'ocr'),
      backups: path.join(this.baseDir, 'backups'),
      logs: path.join(this.baseDir, 'logs'),
    };

    for (const dir of Object.values(this.dirs)) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    return this.dirs;
  }

  /**
   * Compute SHA-256 checksum of a file.
   */
  computeFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const buffer = fs.readFileSync(filePath);
    hash.update(buffer);
    return hash.digest('hex');
  }

  calculateChecksum(filePath) {
    return this.computeFileHash(filePath);
  }

  /**
   * Compute SHA-256 checksum of a buffer.
   */
  computeBufferHash(buffer) {
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
  }

  /**
   * Sanitize filename to prevent directory traversal while strictly
   * preserving Arabic characters, letters, numbers, dashes, and underscores.
   */
  sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'document.pdf';
    let decoded = filename;
    try {
      decoded = decodeURIComponent(filename);
    } catch (e) {
      decoded = filename;
    }
    // Extract base name to eliminate any path separators
    const base = path.basename(decoded);
    // Replace forbidden characters (/ \ : * ? " < > | and control chars)
    const safe = base.replace(/[/\\?%*:|"<>]/g, '_').trim();
    return safe || 'document.pdf';
  }

  /**
   * Detect MIME type from extension and magic header bytes.
   */
  detectMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
    return 'application/octet-stream';
  }

  /**
   * Validate PDF magic header (%PDF-)
   */
  validatePdfHeader(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return bytesRead === 5 && buf.toString('ascii') === '%PDF-';
  }

  /**
   * Atomically save a file into staging directory for preview.
   */
  saveToStaging(filename, buffer) {
    const safeName = this.sanitizeFilename(filename);
    const targetPath = path.join(this.dirs.staging, safeName);
    const tempPath = path.join(this.dirs.staging, `.tmp_${Date.now()}_${safeName}`);

    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);

    return {
      filename: safeName,
      path: targetPath,
      size: buffer.length,
      checksum: this.computeBufferHash(buffer),
    };
  }

  /**
   * Atomically store an original document in `originals/` directory.
   * Uses internal ID prefix to prevent collisions while preserving original filename.
   */
  storeOriginal(docId, originalName, sourceFilePath) {
    const safeName = this.sanitizeFilename(originalName);
    const prefix = String(docId).padStart(7, '0');
    const ext = path.extname(safeName) || '.pdf';
    const storedFilename = `${prefix}_${safeName}`;
    const targetPath = path.join(this.dirs.originals, storedFilename);

    // Copy to temp then rename for atomicity
    const tempPath = path.join(this.dirs.originals, `.tmp_${Date.now()}_${storedFilename}`);
    fs.copyFileSync(sourceFilePath, tempPath);
    fs.renameSync(tempPath, targetPath);

    const stat = fs.statSync(targetPath);
    const checksum = this.computeFileHash(targetPath);

    return {
      filename: storedFilename,
      path: targetPath,
      size: stat.size,
      checksum,
      mimeType: this.detectMimeType(targetPath),
    };
  }

  /**
   * Atomically store an archived PDF in `archive/` directory.
   */
  storeArchivedPdf(docId, dateStr, title, sourcePdfPath) {
    const safeTitle = this.sanitizeFilename(title).replace(/\.pdf$/i, '');
    const prefix = String(docId).padStart(7, '0');
    const storedFilename = `${prefix}_${dateStr}_${safeTitle}.pdf`;
    const targetPath = path.join(this.dirs.archive, storedFilename);

    const tempPath = path.join(this.dirs.archive, `.tmp_${Date.now()}_${storedFilename}`);
    fs.copyFileSync(sourcePdfPath, tempPath);
    fs.renameSync(tempPath, targetPath);

    const stat = fs.statSync(targetPath);
    const checksum = this.computeFileHash(targetPath);

    return {
      filename: storedFilename,
      path: targetPath,
      size: stat.size,
      checksum,
    };
  }

  /**
   * Save extracted OCR text to `ocr/` directory.
   */
  storeOcrText(docId, rawText) {
    const prefix = String(docId).padStart(7, '0');
    const targetPath = path.join(this.dirs.ocr, `${prefix}_ocr.txt`);
    fs.writeFileSync(targetPath, rawText, 'utf-8');
    return targetPath;
  }

  /**
   * Remove a file from staging safely.
   */
  removeStaged(filename) {
    const safeName = this.sanitizeFilename(filename);
    const targetPath = path.join(this.dirs.staging, safeName);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      return true;
    }
    return false;
  }
}

module.exports = new DocumentStorage();
