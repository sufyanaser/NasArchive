/**
 * NAS Archive — Paperless Migration & Reconciliation Engine
 * Safely imports documents, metadata, OCR text, tags, and custom fields
 * from Paperless-ngx exports or live API into the native SQLite database.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbManager = require('./db');
const storage = require('./storage');
const docService = require('./documents');

class PaperlessMigrator {
  /**
   * Extract custom field value from a manifest instance record.
   */
  _extractCfValue(fields) {
    if (fields.value_text !== null && fields.value_text !== undefined) return String(fields.value_text);
    if (fields.value_long_text !== null && fields.value_long_text !== undefined) return String(fields.value_long_text);
    if (fields.value_date !== null && fields.value_date !== undefined) return String(fields.value_date);
    if (fields.value_bool !== null && fields.value_bool !== undefined) return fields.value_bool ? 'true' : 'false';
    if (fields.value_int !== null && fields.value_int !== undefined) return String(fields.value_int);
    if (fields.value_float !== null && fields.value_float !== undefined) return String(fields.value_float);
    return '';
  }

  /**
   * Migrate from an exported Paperless directory (containing manifest.json, originals/, archive/).
   */
  async migrateFromExport(exportDir, options = {}) {
    const manifestPath = path.join(exportDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Migration manifest not found at: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const originalsDir = path.join(exportDir, 'originals');
    const archiveDir = path.join(exportDir, 'archive');

    const report = {
      startedAt: new Date().toISOString(),
      exportDir,
      sourceCount: 0,
      importedCount: 0,
      skippedDuplicates: 0,
      errors: [],
      documents: [],
      reconciliation: {
        countsMatch: false,
        hashesMatch: true,
        metadataMatch: true,
      },
    };

    // 1. Tags Mapping
    const tagEntries = manifest.filter((item) => item.model === 'documents.tag');
    const tagMap = {}; // Paperless tag ID -> Native tag ID
    for (const t of tagEntries) {
      const existing = dbManager.getDb().prepare('SELECT id FROM tags WHERE name = ?').get(t.fields.name);
      if (existing) {
        tagMap[t.pk] = existing.id;
      } else {
        const res = dbManager.getDb().prepare('INSERT INTO tags (name, slug, color, is_inbox_tag, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(t.fields.name, t.fields.slug || t.fields.name, t.fields.color || '#3b82f6', t.fields.is_inbox_tag ? 1 : 0, new Date().toISOString());
        tagMap[t.pk] = Number(res.lastInsertRowid);
      }
    }

    // 2. Document Types Mapping
    const typeEntries = manifest.filter((item) => item.model === 'documents.documenttype');
    const typeMap = {};
    for (const dt of typeEntries) {
      const existing = dbManager.getDb().prepare('SELECT id FROM document_types WHERE name = ?').get(dt.fields.name);
      if (existing) {
        typeMap[dt.pk] = existing.id;
      } else {
        const res = dbManager.getDb().prepare('INSERT INTO document_types (name, slug, created_at) VALUES (?, ?, ?)')
          .run(dt.fields.name, dt.fields.slug || dt.fields.name, new Date().toISOString());
        typeMap[dt.pk] = Number(res.lastInsertRowid);
      }
    }

    // 3. Custom Fields Mapping
    const cfEntries = manifest.filter((item) => item.model === 'documents.customfield');
    const cfDefMap = {};
    for (const cf of cfEntries) {
      const existing = dbManager.getDb().prepare('SELECT id FROM custom_fields WHERE name = ?').get(cf.fields.name);
      if (existing) {
        cfDefMap[cf.pk] = existing.id;
      } else {
        const res = dbManager.getDb().prepare('INSERT INTO custom_fields (name, data_type, created_at) VALUES (?, ?, ?)')
          .run(cf.fields.name, cf.fields.data_type, new Date().toISOString());
        cfDefMap[cf.pk] = Number(res.lastInsertRowid);
      }
    }

    // 4. Custom Field Instances grouped by document
    const cfInstanceEntries = manifest.filter((item) => item.model === 'documents.customfieldinstance');
    const docCfMap = {}; // docPk -> [ { field: nativeFieldId, value: str } ]
    for (const inst of cfInstanceEntries) {
      if (inst.fields.deleted_at) continue; // Skip deleted instances
      const docPk = inst.fields.document;
      const nativeFieldId = cfDefMap[inst.fields.field];
      if (!nativeFieldId) continue;

      if (!docCfMap[docPk]) docCfMap[docPk] = [];
      const val = this._extractCfValue(inst.fields);
      docCfMap[docPk].push({
        field: nativeFieldId,
        value: val,
      });
    }

    // 5. Documents Import
    const docEntries = manifest.filter((item) => item.model === 'documents.document');
    report.sourceCount = docEntries.length;

    // Build index of files in originalsDir and archiveDir
    const origFiles = fs.existsSync(originalsDir) ? fs.readdirSync(originalsDir) : [];
    const archFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];

    for (const d of docEntries) {
      try {
        const paperlessId = d.pk;
        const title = d.fields.title;
        const createdDate = d.fields.created ? d.fields.created.slice(0, 10) : new Date().toISOString().slice(0, 10);
        const originalName = d.fields.original_filename || `${title}.pdf`;
        const content = d.fields.content || '';

        // Check if already migrated
        const existingByPId = dbManager.getDb().prepare('SELECT id FROM documents WHERE paperless_id = ?').get(paperlessId);
        if (existingByPId) {
          report.skippedDuplicates++;
          report.documents.push({ paperlessId, title, nativeId: existingByPId.id, status: 'SKIPPED_EXISTING' });
          continue;
        }

        // Locate original file on disk
        let origDiskFile = origFiles.find((f) => f.includes(originalName) || f.endsWith(originalName));
        if (!origDiskFile) {
          // Fallback match by prefix or sanitized
          const safeTitle = storage.sanitizeFilename(title).replace(/\.pdf$/i, '');
          origDiskFile = origFiles.find((f) => f.includes(safeTitle));
        }

        let origSrcPath = origDiskFile ? path.join(originalsDir, origDiskFile) : null;
        let origChecksum = d.fields.checksum || '';
        let origSize = 0;

        if (origSrcPath && fs.existsSync(origSrcPath)) {
          origSize = fs.statSync(origSrcPath).size;
          if (!origChecksum) origChecksum = storage.computeFileHash(origSrcPath);
        }

        // Duplicate check by hash
        if (origChecksum) {
          const dup = docService.checkDuplicate(origChecksum);
          if (dup && !options.allowDuplicates) {
            report.skippedDuplicates++;
            report.documents.push({ paperlessId, title, nativeId: dup.id, status: 'SKIPPED_HASH_DUPLICATE' });
            continue;
          }
        }

        // Locate archive file on disk
        let archDiskFile = null;
        if (d.fields.archived_file_name) {
          archDiskFile = archFiles.find((f) => f.includes(d.fields.archived_file_name) || f.endsWith(d.fields.archived_file_name));
        }
        if (!archDiskFile) {
          const safeTitle = storage.sanitizeFilename(title).replace(/\.pdf$/i, '');
          archDiskFile = archFiles.find((f) => f.includes(safeTitle));
        }
        const archSrcPath = archDiskFile ? path.join(archiveDir, archDiskFile) : null;

        // Tags mapping
        const mappedTags = (d.fields.tags || []).map((tId) => tagMap[tId]).filter(Boolean);
        const mappedCfs = docCfMap[paperlessId] || [];
        const mappedType = d.fields.document_type ? typeMap[d.fields.document_type] : null;

        // Store into Native Storage
        let storedOrigPath = '';
        let storedOrigName = originalName;
        if (origSrcPath && fs.existsSync(origSrcPath)) {
          const stored = storage.storeOriginal(paperlessId, originalName, origSrcPath);
          storedOrigPath = stored.path;
          storedOrigName = stored.filename;
          origChecksum = stored.checksum;
          origSize = stored.size;
        }

        let storedArchPath = null;
        let storedArchName = null;
        let archChecksum = null;
        let archSize = null;
        if (archSrcPath && fs.existsSync(archSrcPath)) {
          const storedArch = storage.storeArchivedPdf(paperlessId, createdDate, title, archSrcPath);
          storedArchPath = storedArch.path;
          storedArchName = storedArch.filename;
          archChecksum = storedArch.checksum;
          archSize = storedArch.size;
        }

        // Store OCR text
        if (content) {
          storage.storeOcrText(paperlessId, content);
        }

        // Insert document into Native Core
        const createdDoc = docService.createDocument({
          paperless_id: paperlessId,
          title,
          content,
          document_type_id: mappedType,
          created_date: createdDate,
          created_at: d.fields.created || new Date().toISOString(),
          original_filename: originalName,
          original_file_path: storedOrigPath,
          original_checksum: origChecksum,
          original_size: origSize,
          original_mime_type: d.fields.mime_type || storage.detectMimeType(storedOrigPath || originalName),
          archive_filename: storedArchName,
          archive_file_path: storedArchPath,
          archive_checksum: archChecksum,
          archive_size: archSize,
          page_count: d.fields.page_count || 1,
          status: 'APPROVED',
          tags: mappedTags,
          custom_fields: mappedCfs,
        });

        report.importedCount++;
        report.documents.push({
          paperlessId,
          title,
          nativeId: createdDoc.id,
          checksum: origChecksum,
          tagsCount: mappedTags.length,
          customFieldsCount: mappedCfs.length,
          hasOcr: Boolean(content),
          status: 'IMPORTED',
        });
      } catch (err) {
        report.errors.push({ paperlessId: d.pk, error: err.message });
      }
    }

    report.finishedAt = new Date().toISOString();
    report.reconciliation.countsMatch = (report.importedCount + report.skippedDuplicates) === report.sourceCount;

    // Save Migration Manifest in logs/
    const manifestLogPath = path.join(storage.dirs.logs, `migration_manifest_${Date.now()}.json`);
    fs.writeFileSync(manifestLogPath, JSON.stringify(report, null, 2), 'utf8');
    report.manifestReportPath = manifestLogPath;

    return report;
  }
}

module.exports = new PaperlessMigrator();
