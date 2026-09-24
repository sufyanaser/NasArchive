/**
 * NAS Archive — Native Document Repository & Service
 * Provides full document lifecycle operations, FTS5 search, tags, custom fields,
 * and approval management with zero Docker or Paperless dependencies.
 */
const crypto = require('crypto');
const dbManager = require('./db');
const storage = require('./storage');
const { normalizeArabic, buildFtsQuery, sanitizeReferenceNumber } = require('./normalizer');

class DocumentService {
  /**
   * Helper to format a single document record from DB into frontend-compatible JSON.
   */
  _formatDocument(docRow, tags, customFieldRows, typeRow, corrRow) {
    if (!docRow) return null;

    const cfList = (customFieldRows || []).map((cf) => ({
      field: cf.field_id,
      name: cf.name,
      data_type: cf.data_type,
      value: cf.data_type === 'boolean' ? cf.value_text === 'true' : cf.value_text,
    }));

    return {
      id: docRow.id,
      uuid: docRow.uuid,
      paperless_id: docRow.paperless_id,
      title: docRow.title,
      content: docRow.content || '',
      correspondent: docRow.correspondent_id,
      correspondent_name: corrRow ? corrRow.name : null,
      document_type: docRow.document_type_id,
      document_type_name: typeRow ? typeRow.name : null,
      tags: (tags || []).map((t) => t.id),
      tag_objects: tags || [],
      created: docRow.created_date,
      created_date: docRow.created_date,
      created_at: docRow.created_at,
      modified: docRow.modified_at,
      modified_at: docRow.modified_at,
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
    const row = db.prepare('SELECT id, title, created_date, original_filename FROM documents WHERE original_checksum = ? LIMIT 1').get(checksum);
    return row || null;
  }

  /**
   * Get total documents count.
   */
  getCount(params = {}) {
    const db = dbManager.getDb();
    let query = 'SELECT COUNT(DISTINCT d.id) as count FROM documents d';
    const conditions = [];
    const args = [];

    if (params.department && params.department !== 'الكل') {
      query += ' JOIN document_tags dt ON d.id = dt.document_id JOIN tags t ON dt.tag_id = t.id';
      conditions.push('t.name = ?');
      args.push(params.department);
    } else if (params.tag_id || params.tags__id__in) {
      const tid = params.tag_id || params.tags__id__in;
      query += ' JOIN document_tags dt_t ON d.id = dt_t.document_id';
      conditions.push('dt_t.tag_id = ?');
      args.push(tid);
    }

    if (params.search) {
      const fts = buildFtsQuery(params.search);
      if (fts) {
        query += ' JOIN documents_fts fts ON d.id = fts.rowid';
        conditions.push('documents_fts MATCH ?');
        args.push(fts);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const res = db.prepare(query).get(...args);
    return res ? res.count : 0;
  }

  /**
   * List documents with department filtering, search, pagination, and sorting.
   */
  listDocuments(params = {}) {
    const db = dbManager.getDb();
    const page = Math.max(1, parseInt(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(params.page_size) || 50));
    const offset = (page - 1) * pageSize;

    let baseQuery = `
      SELECT DISTINCT d.id
      FROM documents d
    `;
    const joins = [];
    const conditions = [];
    const args = [];

    // Filter by Department (tag)
    if (params.department && params.department !== 'الكل') {
      joins.push('JOIN document_tags dt_dept ON d.id = dt_dept.document_id');
      joins.push('JOIN tags t_dept ON dt_dept.tag_id = t_dept.id');
      conditions.push('t_dept.name = ?');
      args.push(params.department);
    } else if (params.tag_id || params.tags__id__in) {
      const tid = params.tag_id || params.tags__id__in;
      joins.push('JOIN document_tags dt_t ON d.id = dt_t.document_id');
      conditions.push('dt_t.tag_id = ?');
      args.push(tid);
    }

    // Filter by Inbox / Pending Review
    if (params.inbox_only) {
      joins.push('JOIN document_tags dt_inbox ON d.id = dt_inbox.document_id');
      joins.push('JOIN tags t_inbox ON dt_inbox.tag_id = t_inbox.id');
      conditions.push('t_inbox.is_inbox_tag = 1');
    }

    // Full-Text Search via FTS5
    if (params.search && params.search.trim()) {
      const fts = buildFtsQuery(params.search);
      if (fts) {
        joins.push('JOIN documents_fts fts ON d.id = fts.rowid');
        conditions.push('documents_fts MATCH ?');
        args.push(fts);
      } else {
        // Fallback LIKE search for simple substring
        conditions.push('(d.title LIKE ? OR d.original_filename LIKE ?)');
        const likePattern = `%${params.search.trim()}%`;
        args.push(likePattern, likePattern);
      }
    }

    if (joins.length > 0) {
      baseQuery += ' ' + joins.join(' ');
    }
    if (conditions.length > 0) {
      baseQuery += ' WHERE ' + conditions.join(' AND ');
    }

    // Sorting
    baseQuery += ' ORDER BY d.id DESC LIMIT ? OFFSET ?';
    args.push(pageSize, offset);

    const idRows = db.prepare(baseQuery).all(...args);
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

    return this._formatDocument(docRow, tags, customFieldRows, typeRow, corrRow);
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
          uuid, paperless_id, title, content, correspondent_id, document_type_id,
          created_date, created_at, modified_at, original_filename, original_file_path,
          original_checksum, original_size, original_mime_type, archive_filename,
          archive_file_path, archive_checksum, archive_size, thumbnail_path, page_count,
          status, is_approved_for_sync, approved_hash, reviewed_by, reviewed_at, notes
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
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
        data.created_date || today,
        data.created_at || now,
        now,
        data.original_filename,
        data.original_file_path,
        data.original_checksum,
        data.original_size,
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
      if (Array.isArray(data.tags)) {
        const tagStmt = trx.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)');
        for (const tagId of data.tags) {
          tagStmt.run(docId, tagId);
        }
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

      // 4. Index in FTS5 (including custom fields values)
      const cfText = (data.custom_fields || []).map((cf) => cf ? String(cf.value || '') : '').join(' ');
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
        values.push(patch.document_type);
      }
      if (patch.correspondent !== undefined) {
        sets.push('correspondent_id = ?');
        values.push(patch.correspondent);
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
        const updated = trx.prepare('SELECT title, content, original_filename FROM documents WHERE id = ?').get(id);
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

      return this.getDocument(id);
    });
  }

  /**
   * Delete a document and its associated records and files.
   */
  deleteDocument(id) {
    const db = dbManager.getDb();
    const doc = this.getDocument(id);
    if (!doc) return false;

    dbManager.transaction((trx) => {
      trx.prepare('DELETE FROM documents WHERE id = ?').run(id);
      trx.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id);
    });

    return true;
  }

  /**
   * Get all tags.
   */
  getTags() {
    const db = dbManager.getDb();
    const tags = db.prepare('SELECT * FROM tags ORDER BY id ASC').all();
    return { count: tags.length, results: tags };
  }

  /**
   * Get all document types.
   */
  getDocumentTypes() {
    const db = dbManager.getDb();
    const types = db.prepare('SELECT * FROM document_types ORDER BY id ASC').all();
    return { count: types.length, results: types };
  }

  /**
   * Get all custom field definitions.
   */
  getCustomFields() {
    const db = dbManager.getDb();
    const fields = db.prepare('SELECT * FROM custom_fields ORDER BY id ASC').all();
    return { count: fields.length, results: fields };
  }

  /**
   * Get all correspondents.
   */
  getCorrespondents() {
    const db = dbManager.getDb();
    const list = db.prepare('SELECT * FROM correspondents ORDER BY id ASC').all();
    return { count: list.length, results: list };
  }
}

module.exports = new DocumentService();
