/**
 * NAS Archive — Native Document Repository & Service
 * Provides full document lifecycle operations, FTS5 search, tags, custom fields,
 * soft-delete (trash), restore, bulk actions, and approval management with zero Docker dependencies.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbManager = require('./db');
const storage = require('./storage');
const { normalizeArabic, buildFtsQuery, sanitizeReferenceNumber } = require('./normalizer');

class DocumentService {
  /**
   * Helper to format a single document record from DB into frontend-compatible JSON.
   */
  _formatDocument(docRow, tags, customFieldRows, typeRow, corrRow, storagePathRow) {
    if (!docRow) return null;

    const cfList = (customFieldRows || []).map((cf) => ({
      field: cf.field_id,
      name: cf.name,
      data_type: cf.data_type,
      value: cf.data_type === 'boolean' ? cf.value_text === 'true' : cf.value_text,
    }));

    const deptTag = (tags || []).find((t) => ['شخصي', 'الرنين', 'تناسق', 'NAS FM'].includes(t.name));

    return {
      id: docRow.id,
      uuid: docRow.uuid,
      paperless_id: docRow.paperless_id,
      title: docRow.title,
      department: deptTag ? deptTag.name : null,
      content: docRow.content || '',
      correspondent: docRow.correspondent_id,
      correspondent_name: corrRow ? corrRow.name : null,
      document_type: docRow.document_type_id,
      document_type_name: typeRow ? typeRow.name : null,
      storage_path: docRow.storage_path_id,
      storage_path_name: storagePathRow ? storagePathRow.name : null,
      tags: (tags || []).map((t) => t.id),
      tag_objects: tags || [],
      created: docRow.created_date,
      created_date: docRow.created_date,
      created_at: docRow.created_at,
      modified: docRow.modified_at,
      modified_at: docRow.modified_at,
      deleted_at: docRow.deleted_at || null,
      original_filename: docRow.original_filename,
      original_file_path: docRow.original_file_path,
      original_checksum: docRow.original_checksum,
      original_size: docRow.original_size,
      original_mime_type: docRow.original_mime_type,
      archive_filename: docRow.archive_filename,
      archive_file_path: docRow.archive_file_path,
      archive_checksum: docRow.archive_checksum,
      archive_size: docRow.archive_size,
      thumbnail_path: docRow.thumbnail_path,
      page_count: docRow.page_count,
      status: docRow.status,
      is_approved_for_sync: Boolean(docRow.is_approved_for_sync),
      approved_hash: docRow.approved_hash,
      reviewed_by: docRow.reviewed_by,
      reviewed_at: docRow.reviewed_at,
      notes: docRow.notes,
      custom_fields: cfList,
    };
  }

  /**
   * Calculate approval hash for cloud sync contract.
   */
  calculateApprovalHash(docRow, tagNames, customFieldsMap) {
    const canonical = [
      String(docRow.id),
      docRow.title.trim(),
      docRow.original_checksum,
      (tagNames || []).sort().join(','),
      sanitizeReferenceNumber(customFieldsMap['رقم الكتاب'] || ''),
      sanitizeReferenceNumber(customFieldsMap['رقم القيد'] || ''),
      (customFieldsMap['الجهة المرسلة'] || '').trim(),
      (customFieldsMap['الجهة المستلمة'] || '').trim(),
      (customFieldsMap['تاريخ الورود'] || '').trim(),
    ].join('|');

    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Check if a document with the same SHA-256 checksum already exists.
   */
  checkDuplicate(checksum) {
    const db = dbManager.getDb();
    const row = db.prepare('SELECT id, title, created_date, original_filename FROM documents WHERE original_checksum = ? AND deleted_at IS NULL LIMIT 1').get(checksum);
    return row || null;
  }

  /**
   * Internal query conditions builder shared by getCount and listDocuments.
   */
  _buildQueryConditions(params = {}) {
    const joins = [];
    const conditions = [];
    const args = [];

    // Soft delete / trash filter
    if (params.trash) {
      conditions.push('d.deleted_at IS NOT NULL');
    } else {
      conditions.push('d.deleted_at IS NULL');
    }

    // Filter by Department (tag name)
    if (params.department && params.department !== 'الكل') {
      joins.push('JOIN document_tags dt_dept ON d.id = dt_dept.document_id');
      joins.push('JOIN tags t_dept ON dt_dept.tag_id = t_dept.id');
      conditions.push('t_dept.name = ?');
      args.push(params.department);
    }

    // Filter by tags (single tag or array of tag IDs)
    if (params.tag_id || params.tags__id__in || params.tags) {
      const tagInput = params.tag_id || params.tags__id__in || params.tags;
      const tagIds = Array.isArray(tagInput)
        ? tagInput.map((x) => parseInt(x, 10)).filter(Boolean)
        : String(tagInput).split(',').map((x) => parseInt(x.trim(), 10)).filter(Boolean);

      if (tagIds.length > 0) {
        joins.push('JOIN document_tags dt_t ON d.id = dt_t.document_id');
        const placeholders = tagIds.map(() => '?').join(',');
        conditions.push(`dt_t.tag_id IN (${placeholders})`);
        args.push(...tagIds);
      }
    }

    // Filter by Correspondent
    if (params.correspondent_id || params.correspondent) {
      const corrId = parseInt(params.correspondent_id || params.correspondent, 10);
      if (corrId) {
        conditions.push('d.correspondent_id = ?');
        args.push(corrId);
      }
    }

    // Filter by Document Type
    if (params.document_type_id || params.document_type) {
      const typeId = parseInt(params.document_type_id || params.document_type, 10);
      if (typeId) {
        conditions.push('d.document_type_id = ?');
        args.push(typeId);
      }
    }

    // Filter by Storage Path
    if (params.storage_path_id || params.storage_path) {
      const spId = parseInt(params.storage_path_id || params.storage_path, 10);
      if (spId) {
        conditions.push('d.storage_path_id = ?');
        args.push(spId);
      }
    }

    // Filter by Date Range (created_date)
    if (params.date_from) {
      conditions.push('d.created_date >= ?');
      args.push(params.date_from);
    }
    if (params.date_to) {
      conditions.push('d.created_date <= ?');
      args.push(params.date_to);
    }

    // Filter by Approval / Sync status
    if (params.is_approved_for_sync !== undefined) {
      conditions.push('d.is_approved_for_sync = ?');
      args.push(params.is_approved_for_sync ? 1 : 0);
    }

    // Filter by Status string ('APPROVED', 'INBOX')
    if (params.status) {
      conditions.push('d.status = ?');
      args.push(params.status);
    }

    // Filter by Inbox / Pending Review
    if (params.inbox_only) {
      joins.push('JOIN document_tags dt_inbox ON d.id = dt_inbox.document_id');
      joins.push('JOIN tags t_inbox ON dt_inbox.tag_id = t_inbox.id');
      conditions.push('t_inbox.is_inbox_tag = 1');
    }

    // Filter by Custom Field value
    if (params.custom_field_id && params.custom_field_value) {
      joins.push('JOIN document_custom_fields dcf_f ON d.id = dcf_f.document_id');
      conditions.push('dcf_f.field_id = ? AND dcf_f.value_text LIKE ?');
      args.push(params.custom_field_id, `%${params.custom_field_value}%`);
    }

    // Full-Text Search via FTS5
    if (params.search && params.search.trim()) {
      const fts = buildFtsQuery(params.search);
      if (fts) {
        joins.push('JOIN documents_fts fts ON d.id = fts.rowid');
        conditions.push('documents_fts MATCH ?');
        args.push(fts);
      } else {
        conditions.push('(d.title LIKE ? OR d.original_filename LIKE ?)');
        const likePattern = `%${params.search.trim()}%`;
        args.push(likePattern, likePattern);
      }
    }

    return { joins, conditions, args };
  }

  /**
   * Get total documents count with active filters.
   */
  getCount(params = {}) {
    const db = dbManager.getDb();
    const { joins, conditions, args } = this._buildQueryConditions(params);

    let query = 'SELECT COUNT(DISTINCT d.id) as count FROM documents d';
    if (joins.length > 0) {
      query += ' ' + joins.join(' ');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const res = db.prepare(query).get(...args);
    return res ? res.count : 0;
  }

  /**
   * List documents with advanced filtering, search, pagination, and sorting.
   */
  listDocuments(params = {}) {
    const db = dbManager.getDb();
    const page = Math.max(1, parseInt(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(params.page_size) || 50));
    const offset = (page - 1) * pageSize;

    const { joins, conditions, args } = this._buildQueryConditions(params);

    let baseQuery = 'SELECT DISTINCT d.id FROM documents d';
    if (joins.length > 0) {
      baseQuery += ' ' + joins.join(' ');
    }
    if (conditions.length > 0) {
      baseQuery += ' WHERE ' + conditions.join(' AND ');
    }

    // Sorting
    let sortColumn = 'd.id';
    let sortDirection = 'DESC';

    const ordering = params.ordering || params.sort_by;
    if (ordering) {
      const isDesc = ordering.startsWith('-') || params.sort_order === 'DESC';
      const cleanCol = ordering.replace(/^[-+]/, '');
      sortDirection = isDesc ? 'DESC' : 'ASC';

      if (cleanCol === 'created' || cleanCol === 'created_date') sortColumn = 'd.created_date';
      else if (cleanCol === 'title') sortColumn = 'd.title';
      else if (cleanCol === 'modified' || cleanCol === 'modified_at') sortColumn = 'd.modified_at';
      else if (cleanCol === 'id') sortColumn = 'd.id';
      else if (cleanCol === 'original_filename') sortColumn = 'd.original_filename';
    }

    baseQuery += ` ORDER BY ${sortColumn} ${sortDirection}, d.id DESC LIMIT ? OFFSET ?`;
    const queryArgs = [...args, pageSize, offset];

    const idRows = db.prepare(baseQuery).all(...queryArgs);
    const docIds = idRows.map((r) => r.id);

    if (docIds.length === 0) {
      return { count: this.getCount(params), results: [] };
    }

    // Fetch full details for returned IDs
    const results = docIds.map((id) => this.getDocument(id));
    return {
      count: this.getCount(params),
      results,
    };
  }

  /**
   * Get single document by ID with all relations.
   */
  getDocument(id) {
    const db = dbManager.getDb();
    const docRow = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!docRow) return null;

    // Tags
    const tags = db.prepare(`
      SELECT t.id, t.name, t.slug, t.color, t.text_color, t.is_inbox_tag
      FROM document_tags dt
      JOIN tags t ON dt.tag_id = t.id
      WHERE dt.document_id = ?
    `).all(id);

    // Custom fields
    const customFieldRows = db.prepare(`
      SELECT dcf.field_id, cf.name, cf.data_type, dcf.value_text
      FROM document_custom_fields dcf
      JOIN custom_fields cf ON dcf.field_id = cf.id
      WHERE dcf.document_id = ?
    `).all(id);

    // Document type
    let typeRow = null;
    if (docRow.document_type_id) {
      typeRow = db.prepare('SELECT * FROM document_types WHERE id = ?').get(docRow.document_type_id);
    }

    // Correspondent
    let corrRow = null;
    if (docRow.correspondent_id) {
      corrRow = db.prepare('SELECT * FROM correspondents WHERE id = ?').get(docRow.correspondent_id);
    }

    // Storage Path
    let storagePathRow = null;
    if (docRow.storage_path_id) {
      storagePathRow = db.prepare('SELECT * FROM storage_paths WHERE id = ?').get(docRow.storage_path_id);
    }

    return this._formatDocument(docRow, tags, customFieldRows, typeRow, corrRow, storagePathRow);
  }

  /**
   * Ingest and create a new document in the archive.
   */
  createDocument(data) {
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const uuid = data.uuid || crypto.randomUUID();

    return dbManager.transaction((trx) => {
      // 1. Insert into documents table
      const insertDocStmt = trx.prepare(`
        INSERT INTO documents (
          uuid, paperless_id, title, content, correspondent_id, document_type_id, storage_path_id,
          created_date, created_at, modified_at, original_filename, original_file_path,
          original_checksum, original_size, original_mime_type, archive_filename,
          archive_file_path, archive_checksum, archive_size, thumbnail_path, page_count,
          status, is_approved_for_sync, approved_hash, reviewed_by, reviewed_at, notes
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
      `);

      const res = insertDocStmt.run(
        uuid,
        data.paperless_id || null,
        data.title,
        data.content || '',
        data.correspondent_id || null,
        data.document_type_id || null,
        data.storage_path_id || null,
        data.created_date || today,
        data.created_at || now,
        now,
        data.original_filename || data.filename || 'document.pdf',
        data.original_file_path || null,
        data.original_checksum || (data.original_file_path && fs.existsSync(data.original_file_path) ? storage.computeFileHash(data.original_file_path) : crypto.createHash('sha256').update(uuid).digest('hex')),
        data.original_size || 0,
        data.original_mime_type || 'application/pdf',
        data.archive_filename || null,
        data.archive_file_path || null,
        data.archive_checksum || null,
        data.archive_size || null,
        data.thumbnail_path || null,
        data.page_count || 1,
        data.status || 'APPROVED',
        data.is_approved_for_sync ? 1 : 0,
        data.approved_hash || null,
        data.reviewed_by || null,
        data.reviewed_at || null,
        data.notes || null
      );

      const docId = Number(res.lastInsertRowid);

      // 2. Insert tags
      const tagsToInsert = new Set(Array.isArray(data.tags) ? data.tags : []);
      if (data.department) {
        const deptRow = trx.prepare('SELECT id FROM tags WHERE name = ?').get(data.department.trim());
        if (deptRow) {
          tagsToInsert.add(deptRow.id);
        } else {
          const nowStr = new Date().toISOString();
          const insTag = trx.prepare('INSERT INTO tags (name, slug, color, text_color, is_inbox_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(data.department.trim(), data.department.trim(), '#10b981', '#ffffff', 0, nowStr);
          tagsToInsert.add(Number(insTag.lastInsertRowid));
        }
      }

      const tagStmt = trx.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)');
      for (const tagId of tagsToInsert) {
        tagStmt.run(docId, tagId);
      }

      // 3. Insert custom fields
      if (Array.isArray(data.custom_fields)) {
        const cfStmt = trx.prepare('INSERT OR REPLACE INTO document_custom_fields (document_id, field_id, value_text) VALUES (?, ?, ?)');
        for (const cf of data.custom_fields) {
          if (cf && cf.field) {
            cfStmt.run(docId, cf.field, sanitizeReferenceNumber(cf.value));
          }
        }
      }

      // 4. Index in FTS5
      const cfText = (data.custom_fields || []).map((cf) => (cf ? String(cf.value || '') : '')).join(' ');
      const fullSearchContent = `${data.content || ''} ${cfText}`.trim();
      const ftsStmt = trx.prepare('INSERT INTO documents_fts (rowid, title_norm, content_norm, filename_norm) VALUES (?, ?, ?, ?)');
      ftsStmt.run(
        docId,
        normalizeArabic(data.title),
        normalizeArabic(fullSearchContent),
        normalizeArabic(data.original_filename)
      );

      return this.getDocument(docId);
    });
  }

  /**
   * Update existing document metadata, tags, and custom fields.
   */
  updateDocument(id, patch) {
    const db = dbManager.getDb();
    const existing = this.getDocument(id);
    if (!existing) {
      throw new Error(`Document with ID ${id} not found.`);
    }

    const now = new Date().toISOString();

    return dbManager.transaction((trx) => {
      // 1. Update main document fields
      const sets = ['modified_at = ?'];
      const values = [now];

      if (patch.title !== undefined) {
        sets.push('title = ?');
        values.push(patch.title);
      }
      if (patch.content !== undefined) {
        sets.push('content = ?');
        values.push(patch.content);
      }
      if (patch.created_date !== undefined) {
        sets.push('created_date = ?');
        values.push(patch.created_date);
      }
      if (patch.document_type !== undefined) {
        sets.push('document_type_id = ?');
        values.push(patch.document_type || null);
      }
      if (patch.correspondent !== undefined) {
        sets.push('correspondent_id = ?');
        values.push(patch.correspondent || null);
      }
      if (patch.storage_path !== undefined) {
        sets.push('storage_path_id = ?');
        values.push(patch.storage_path || null);
      }
      if (patch.status !== undefined) {
        sets.push('status = ?');
        values.push(patch.status);
      }
      if (patch.is_approved_for_sync !== undefined) {
        sets.push('is_approved_for_sync = ?');
        values.push(patch.is_approved_for_sync ? 1 : 0);
      }
      if (patch.approved_hash !== undefined) {
        sets.push('approved_hash = ?');
        values.push(patch.approved_hash);
      }
      if (patch.reviewed_by !== undefined) {
        sets.push('reviewed_by = ?');
        values.push(patch.reviewed_by);
      }
      if (patch.reviewed_at !== undefined) {
        sets.push('reviewed_at = ?');
        values.push(patch.reviewed_at);
      }
      if (patch.notes !== undefined) {
        sets.push('notes = ?');
        values.push(patch.notes);
      }

      values.push(id);
      trx.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      // 2. Update tags if provided
      if (Array.isArray(patch.tags)) {
        trx.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
        const tagStmt = trx.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)');
        for (const tagId of patch.tags) {
          tagStmt.run(id, tagId);
        }
      }

      // 3. Update custom fields if provided
      if (Array.isArray(patch.custom_fields)) {
        trx.prepare('DELETE FROM document_custom_fields WHERE document_id = ?').run(id);
        const cfStmt = trx.prepare('INSERT OR REPLACE INTO document_custom_fields (document_id, field_id, value_text) VALUES (?, ?, ?)');
        for (const cf of patch.custom_fields) {
          if (cf && cf.field) {
            cfStmt.run(id, cf.field, sanitizeReferenceNumber(cf.value));
          }
        }
      }

      // 4. Update FTS5 index if title, content, or custom fields changed
      if (patch.title !== undefined || patch.content !== undefined || Array.isArray(patch.custom_fields)) {
        const updated = trx.prepare('SELECT title, content, original_filename, deleted_at FROM documents WHERE id = ?').get(id);
        if (!updated.deleted_at) {
          const cfs = trx.prepare('SELECT value_text FROM document_custom_fields WHERE document_id = ?').all(id);
          const cfText = cfs.map((c) => c.value_text).join(' ');
          const fullSearchContent = `${updated.content || ''} ${cfText}`.trim();

          trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
          trx.prepare('INSERT INTO documents_fts (rowid, title_norm, content_norm, filename_norm) VALUES (?, ?, ?, ?)').run(
            id,
            normalizeArabic(updated.title),
            normalizeArabic(fullSearchContent),
            normalizeArabic(updated.original_filename)
          );
        }
      }

      return this.getDocument(id);
    });
  }

  /**
   * Delete a document: soft-delete by default, or permanent delete.
   */
  deleteDocument(id, permanent = false) {
    const db = dbManager.getDb();
    const doc = this.getDocument(id);
    if (!doc) return false;

    if (permanent) {
      dbManager.transaction((trx) => {
        trx.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM document_custom_fields WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM sync_ledger WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM documents WHERE id = ?').run(id);
        trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
      });
      return true;
    } else {
      const now = new Date().toISOString();
      dbManager.transaction((trx) => {
        trx.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(now, id);
        trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
      });
      return true;
    }
  }

  /**
   * Restore a soft-deleted document from trash.
   */
  restoreDocument(id) {
    const db = dbManager.getDb();
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) return false;

    dbManager.transaction((trx) => {
      trx.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ?').run(id);

      const cfs = trx.prepare('SELECT value_text FROM document_custom_fields WHERE document_id = ?').all(id);
      const cfText = cfs.map((c) => c.value_text).join(' ');
      const fullSearchContent = `${doc.content || ''} ${cfText}`.trim();

      trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
      trx.prepare('INSERT INTO documents_fts (rowid, title_norm, content_norm, filename_norm) VALUES (?, ?, ?, ?)').run(
        id,
        normalizeArabic(doc.title),
        normalizeArabic(fullSearchContent),
        normalizeArabic(doc.original_filename)
      );
    });
    return true;
  }

  /**
   * List trashed documents.
   */
  listTrash(params = {}) {
    return this.listDocuments({ ...params, trash: true });
  }

  /**
   * Permanently purge all trashed documents.
   */
  purgeTrash() {
    const db = dbManager.getDb();
    return dbManager.transaction((trx) => {
      const trashed = trx.prepare('SELECT id FROM documents WHERE deleted_at IS NOT NULL').all();
      const ids = trashed.map((r) => r.id);
      for (const id of ids) {
        trx.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM document_custom_fields WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM sync_ledger WHERE document_id = ?').run(id);
        trx.prepare('DELETE FROM documents WHERE id = ?').run(id);
        trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
      }
      return ids.length;
    });
  }

  // ==========================================
  // BULK OPERATIONS
  // ==========================================
  bulkDelete(ids, permanent = false) {
    let count = 0;
    for (const id of ids) {
      if (this.deleteDocument(id, permanent)) count++;
    }
    return count;
  }

  bulkRestore(ids) {
    let count = 0;
    for (const id of ids) {
      if (this.restoreDocument(id)) count++;
    }
    return count;
  }

  bulkAddTag(ids, tagId) {
    const db = dbManager.getDb();
    return dbManager.transaction((trx) => {
      const stmt = trx.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)');
      let count = 0;
      for (const id of ids) {
        const res = stmt.run(id, tagId);
        if (res.changes > 0) count++;
      }
      return count;
    });
  }

  bulkRemoveTag(ids, tagId) {
    const db = dbManager.getDb();
    return dbManager.transaction((trx) => {
      const stmt = trx.prepare('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?');
      let count = 0;
      for (const id of ids) {
        const res = stmt.run(id, tagId);
        if (res.changes > 0) count++;
      }
      return count;
    });
  }

  bulkApprove(ids) {
    const db = dbManager.getDb();
    const inboxTag = db.prepare('SELECT id FROM tags WHERE is_inbox_tag = 1 LIMIT 1').get();
    return dbManager.transaction((trx) => {
      let count = 0;
      for (const id of ids) {
        trx.prepare("UPDATE documents SET status = 'APPROVED' WHERE id = ?").run(id);
        if (inboxTag) {
          trx.prepare('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?').run(id, inboxTag.id);
        }
        count++;
      }
      return count;
    });
  }

  bulkSetType(ids, typeId) {
    const db = dbManager.getDb();
    return dbManager.transaction((trx) => {
      const stmt = trx.prepare('UPDATE documents SET document_type_id = ? WHERE id = ?');
      let count = 0;
      for (const id of ids) {
        stmt.run(typeId || null, id);
        count++;
      }
      return count;
    });
  }

  bulkSetCorrespondent(ids, correspondentId) {
    const db = dbManager.getDb();
    return dbManager.transaction((trx) => {
      const stmt = trx.prepare('UPDATE documents SET correspondent_id = ? WHERE id = ?');
      let count = 0;
      for (const id of ids) {
        stmt.run(correspondentId || null, id);
        count++;
      }
      return count;
    });
  }

  /**
   * Read binary content of document file for preview/download.
   */
  readBinary(id) {
    const doc = this.getDocument(id);
    if (!doc) throw new Error(`Document #${id} not found.`);
    const filePath = doc.original_file_path || (doc.original_filename ? path.join(storage.dirs.originals, doc.original_filename) : null);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Original file not found: ${doc.original_filename}`);
    }
    const buffer = fs.readFileSync(filePath);
    return {
      success: true,
      id: doc.id,
      filename: doc.original_filename,
      mimeType: doc.original_mime_type || 'application/pdf',
      size: buffer.length,
      base64: buffer.toString('base64'),
    };
  }

  // ==========================================
  // METADATA LISTS
  // ==========================================
  getTags() {
    const db = dbManager.getDb();
    const tags = db.prepare('SELECT * FROM tags ORDER BY id ASC').all();
    return { count: tags.length, results: tags };
  }

  getDocumentTypes() {
    const db = dbManager.getDb();
    const types = db.prepare('SELECT * FROM document_types ORDER BY id ASC').all();
    return { count: types.length, results: types };
  }

  getCustomFields() {
    const db = dbManager.getDb();
    const fields = db.prepare('SELECT * FROM custom_fields ORDER BY id ASC').all();
    return { count: fields.length, results: fields };
  }

  getCorrespondents() {
    const db = dbManager.getDb();
    const list = db.prepare('SELECT * FROM correspondents ORDER BY id ASC').all();
    return { count: list.length, results: list };
  }

  getStoragePaths() {
    const db = dbManager.getDb();
    const list = db.prepare('SELECT * FROM storage_paths ORDER BY id ASC').all();
    return { count: list.length, results: list };
  }
}

module.exports = new DocumentService();
