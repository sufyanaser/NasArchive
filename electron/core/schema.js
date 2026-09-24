/**
 * NAS Archive — Database Schema & Migrations
 * Defines tables, foreign keys, FTS5 full-text indexing, and versioned migrations.
 */

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: documents, tags, types, correspondents, custom fields, sync ledger, and FTS5',
    up: (db) => {
      // 1. Tags Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          slug TEXT,
          color TEXT DEFAULT '#3b82f6',
          text_color TEXT DEFAULT '#ffffff',
          is_inbox_tag INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);

      // 2. Document Types Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          slug TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 3. Correspondents Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS correspondents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          slug TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 4. Custom Fields Definitions Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS custom_fields (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          data_type TEXT NOT NULL,
          extra_data TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 5. Main Documents Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid TEXT NOT NULL UNIQUE,
          paperless_id INTEGER UNIQUE,
          title TEXT NOT NULL,
          content TEXT DEFAULT '',
          correspondent_id INTEGER REFERENCES correspondents(id) ON DELETE SET NULL,
          document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL,
          created_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          modified_at TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          original_file_path TEXT NOT NULL,
          original_checksum TEXT NOT NULL,
          original_size INTEGER NOT NULL,
          original_mime_type TEXT NOT NULL,
          archive_filename TEXT,
          archive_file_path TEXT,
          archive_checksum TEXT,
          archive_size INTEGER,
          thumbnail_path TEXT,
          page_count INTEGER DEFAULT 1,
          status TEXT DEFAULT 'APPROVED',
          is_approved_for_sync INTEGER DEFAULT 0,
          approved_hash TEXT,
          reviewed_by TEXT,
          reviewed_at TEXT,
          notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_docs_created_date ON documents(created_date);
        CREATE INDEX IF NOT EXISTS idx_docs_modified_at ON documents(modified_at);
        CREATE INDEX IF NOT EXISTS idx_docs_checksum ON documents(original_checksum);
        CREATE INDEX IF NOT EXISTS idx_docs_paperless_id ON documents(paperless_id);
        CREATE INDEX IF NOT EXISTS idx_docs_sync_approved ON documents(is_approved_for_sync);
      `);

      // 6. Many-to-Many: Document Tags
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_tags (
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (document_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_doc_tags_tag ON document_tags(tag_id);
      `);

      // 7. Many-to-Many / EAV: Document Custom Fields
      // Note: value_text is strictly TEXT to prevent floating-point or numeric truncation of leading zeros
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_custom_fields (
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
          value_text TEXT NOT NULL,
          PRIMARY KEY (document_id, field_id)
        );
        CREATE INDEX IF NOT EXISTS idx_doc_cf_field ON document_custom_fields(field_id);
      `);

      // 8. Sync Ledger Table (Maintains Google Drive & Sheets state)
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          stable_key TEXT NOT NULL UNIQUE,
          doc_hash TEXT NOT NULL,
          drive_file_id TEXT,
          sheets_row_id TEXT,
          synced_at TEXT NOT NULL,
          sync_status TEXT NOT NULL,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_stable_key ON sync_ledger(stable_key);
      `);

      // 9. Full-Text Search (FTS5) Virtual Table
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          title_norm,
          content_norm,
          filename_norm,
          content = '',
          contentless_delete = 1,
          tokenize = 'unicode61'
        );
      `);

      // 10. Seed Initial Canonical Metadata
      const now = new Date().toISOString();
      const insertTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, slug, color, is_inbox_tag, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      insertTag.run(1, 'شخصي', 'personal', '#3b82f6', 0, now);
      insertTag.run(2, 'الرنين', 'raneen', '#10b981', 0, now);
      insertTag.run(3, 'تناسق', 'tanasaq', '#8b5cf6', 0, now);
      insertTag.run(4, 'NAS FM', 'nas-fm', '#f59e0b', 0, now);
      insertTag.run(5, 'بانتظار المراجعة', 'inbox', '#ef4444', 1, now);

      const insertDocType = db.prepare('INSERT OR IGNORE INTO document_types (id, name, slug, created_at) VALUES (?, ?, ?, ?)');
      insertDocType.run(1, 'كتاب وارد', 'incoming', now);
      insertDocType.run(2, 'كتاب صادر', 'outgoing', now);
      insertDocType.run(3, 'كتاب داخلي', 'internal', now);

      const insertField = db.prepare('INSERT OR IGNORE INTO custom_fields (id, name, data_type, created_at) VALUES (?, ?, ?, ?)');
      insertField.run(1, 'رقم الكتاب', 'string', now);
      insertField.run(2, 'الجهة المرسلة', 'string', now);
      insertField.run(3, 'الجهة المستلمة', 'string', now);
      insertField.run(4, 'تاريخ الورود', 'date', now);
      insertField.run(5, 'رقم القيد', 'string', now);
      insertField.run(6, 'الكتاب المرجعي', 'documentlink', now);
      insertField.run(7, 'ملاحظات', 'longtext', now);
      insertField.run(8, 'معتمد للمزامنة', 'boolean', now);
      insertField.run(9, 'راجعه', 'string', now);
      insertField.run(10, 'تاريخ المراجعة', 'date', now);
    },
  },
];

module.exports = {
  MIGRATIONS,
};
