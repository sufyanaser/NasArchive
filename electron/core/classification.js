/**
 * NAS Archive — Classification & Attributes Service
 * Provides full database-backed CRUD operations for Tags, Correspondents,
 * Document Types, Storage Paths, and Custom Fields.
 */
const dbManager = require('./db');

class ClassificationService {
  // ==========================================
  // 1. TAGS
  // ==========================================
  listTags() {
    const db = dbManager.getDb();
    const tags = db.prepare('SELECT * FROM tags ORDER BY id ASC').all();
    return { count: tags.length, results: tags };
  }

  getTag(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(id) || null;
  }

  createTag({ name, color = '#3b82f6', text_color = '#ffffff', is_inbox_tag = 0 }) {
    if (!name || !name.trim()) throw new Error('اسم الوسم مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    const stmt = db.prepare(`
      INSERT INTO tags (name, slug, color, text_color, is_inbox_tag, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name.trim(), slug, color, text_color, is_inbox_tag ? 1 : 0, now);
    return this.getTag(Number(res.lastInsertRowid));
  }

  updateTag(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getTag(id);
    if (!existing) throw new Error(`الوسم رقم ${id} غير موجود.`);

    const sets = [];
    const args = [];

    if (patch.name !== undefined && patch.name.trim()) {
      sets.push('name = ?');
      args.push(patch.name.trim());
      sets.push('slug = ?');
      args.push(patch.name.trim().toLowerCase().replace(/\s+/g, '-'));
    }
    if (patch.color !== undefined) {
      sets.push('color = ?');
      args.push(patch.color);
    }
    if (patch.text_color !== undefined) {
      sets.push('text_color = ?');
      args.push(patch.text_color);
    }
    if (patch.is_inbox_tag !== undefined) {
      sets.push('is_inbox_tag = ?');
      args.push(patch.is_inbox_tag ? 1 : 0);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getTag(id);
  }

  deleteTag(id) {
    const db = dbManager.getDb();
    const existing = this.getTag(id);
    if (!existing) return false;

    dbManager.transaction((trx) => {
      trx.prepare('DELETE FROM document_tags WHERE tag_id = ?').run(id);
      trx.prepare('DELETE FROM tags WHERE id = ?').run(id);
    });
    return true;
  }

  // ==========================================
  // 2. CORRESPONDENTS
  // ==========================================
  listCorrespondents() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM correspondents ORDER BY id ASC').all();
    return { count: rows.length, results: rows };
  }

  getCorrespondent(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT * FROM correspondents WHERE id = ?').get(id) || null;
  }

  createCorrespondent({ name }) {
    if (!name || !name.trim()) throw new Error('اسم جهة التراسل مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    const stmt = db.prepare('INSERT INTO correspondents (name, slug, created_at) VALUES (?, ?, ?)');
    const res = stmt.run(name.trim(), slug, now);
    return this.getCorrespondent(Number(res.lastInsertRowid));
  }

  updateCorrespondent(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getCorrespondent(id);
    if (!existing) throw new Error(`جهة التراسل رقم ${id} غير موجودة.`);

    if (patch.name !== undefined && patch.name.trim()) {
      const slug = patch.name.trim().toLowerCase().replace(/\s+/g, '-');
      db.prepare('UPDATE correspondents SET name = ?, slug = ? WHERE id = ?').run(patch.name.trim(), slug, id);
    }
    return this.getCorrespondent(id);
  }

  deleteCorrespondent(id) {
    const db = dbManager.getDb();
    const existing = this.getCorrespondent(id);
    if (!existing) return false;

    dbManager.transaction((trx) => {
      trx.prepare('UPDATE documents SET correspondent_id = NULL WHERE correspondent_id = ?').run(id);
      trx.prepare('DELETE FROM correspondents WHERE id = ?').run(id);
    });
    return true;
  }

  // ==========================================
  // 3. DOCUMENT TYPES
  // ==========================================
  listDocumentTypes() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM document_types ORDER BY id ASC').all();
    return { count: rows.length, results: rows };
  }

  getDocumentType(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT * FROM document_types WHERE id = ?').get(id) || null;
  }

  createDocumentType({ name }) {
    if (!name || !name.trim()) throw new Error('اسم نوع المستند مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    const stmt = db.prepare('INSERT INTO document_types (name, slug, created_at) VALUES (?, ?, ?)');
    const res = stmt.run(name.trim(), slug, now);
    return this.getDocumentType(Number(res.lastInsertRowid));
  }

  updateDocumentType(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getDocumentType(id);
    if (!existing) throw new Error(`نوع المستند رقم ${id} غير موجود.`);

    if (patch.name !== undefined && patch.name.trim()) {
      const slug = patch.name.trim().toLowerCase().replace(/\s+/g, '-');
      db.prepare('UPDATE document_types SET name = ?, slug = ? WHERE id = ?').run(patch.name.trim(), slug, id);
    }
    return this.getDocumentType(id);
  }

  deleteDocumentType(id) {
    const db = dbManager.getDb();
    const existing = this.getDocumentType(id);
    if (!existing) return false;

    dbManager.transaction((trx) => {
      trx.prepare('UPDATE documents SET document_type_id = NULL WHERE document_type_id = ?').run(id);
      trx.prepare('DELETE FROM document_types WHERE id = ?').run(id);
    });
    return true;
  }

  // ==========================================
  // 4. STORAGE PATHS
  // ==========================================
  listStoragePaths() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM storage_paths ORDER BY id ASC').all();
    return { count: rows.length, results: rows };
  }

  getStoragePath(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT * FROM storage_paths WHERE id = ?').get(id) || null;
  }

  createStoragePath({ name, path_template = '{department}/{created_year}/{title}', matching_algorithm = 'auto', match_pattern = '' }) {
    if (!name || !name.trim()) throw new Error('اسم مسار التخزين مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO storage_paths (name, path_template, matching_algorithm, match_pattern, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const res = stmt.run(name.trim(), path_template.trim(), matching_algorithm, match_pattern || '', now);
    return this.getStoragePath(Number(res.lastInsertRowid));
  }

  updateStoragePath(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getStoragePath(id);
    if (!existing) throw new Error(`مسار التخزين رقم ${id} غير موجود.`);

    const sets = [];
    const args = [];

    if (patch.name !== undefined && patch.name.trim()) {
      sets.push('name = ?');
      args.push(patch.name.trim());
    }
    if (patch.path_template !== undefined) {
      sets.push('path_template = ?');
      args.push(patch.path_template.trim());
    }
    if (patch.matching_algorithm !== undefined) {
      sets.push('matching_algorithm = ?');
      args.push(patch.matching_algorithm);
    }
    if (patch.match_pattern !== undefined) {
      sets.push('match_pattern = ?');
      args.push(patch.match_pattern);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE storage_paths SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getStoragePath(id);
  }

  deleteStoragePath(id) {
    const db = dbManager.getDb();
    const existing = this.getStoragePath(id);
    if (!existing) return false;

    dbManager.transaction((trx) => {
      trx.prepare('UPDATE documents SET storage_path_id = NULL WHERE storage_path_id = ?').run(id);
      trx.prepare('DELETE FROM storage_paths WHERE id = ?').run(id);
    });
    return true;
  }

  // ==========================================
  // 5. CUSTOM FIELDS
  // ==========================================
  listCustomFields() {
    const db = dbManager.getDb();
    const rows = db.prepare('SELECT * FROM custom_fields ORDER BY id ASC').all();
    return { count: rows.length, results: rows };
  }

  getCustomField(id) {
    const db = dbManager.getDb();
    return db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id) || null;
  }

  createCustomField({ name, data_type = 'string', extra_data = null }) {
    if (!name || !name.trim()) throw new Error('اسم الحقل المخصص مطلوب.');
    const db = dbManager.getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO custom_fields (name, data_type, extra_data, created_at) VALUES (?, ?, ?, ?)');
    const res = stmt.run(name.trim(), data_type, extra_data ? JSON.stringify(extra_data) : null, now);
    return this.getCustomField(Number(res.lastInsertRowid));
  }

  updateCustomField(id, patch = {}) {
    const db = dbManager.getDb();
    const existing = this.getCustomField(id);
    if (!existing) throw new Error(`الحقل المخصص رقم ${id} غير موجود.`);

    const sets = [];
    const args = [];

    if (patch.name !== undefined && patch.name.trim()) {
      sets.push('name = ?');
      args.push(patch.name.trim());
    }
    if (patch.data_type !== undefined) {
      sets.push('data_type = ?');
      args.push(patch.data_type);
    }
    if (patch.extra_data !== undefined) {
      sets.push('extra_data = ?');
      args.push(patch.extra_data ? JSON.stringify(patch.extra_data) : null);
    }

    if (sets.length > 0) {
      args.push(id);
      db.prepare(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    return this.getCustomField(id);
  }

  deleteCustomField(id) {
    const db = dbManager.getDb();
    const existing = this.getCustomField(id);
    if (!existing) return false;

    dbManager.transaction((trx) => {
      trx.prepare('DELETE FROM document_custom_fields WHERE field_id = ?').run(id);
      trx.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
    });
    return true;
  }
}

module.exports = new ClassificationService();
