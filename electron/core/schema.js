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
  {
    version: 2,
    description: 'Restore full Paperless archive features: soft delete, storage paths, saved views, workflows, tasks, logs, and users',
    up: (db) => {
      const now = new Date().toISOString();

      // 1. Soft Delete & Storage Path link in documents
      try {
        db.exec('ALTER TABLE documents ADD COLUMN deleted_at TEXT DEFAULT NULL;');
      } catch (e) {
        // column may already exist
      }
      try {
        db.exec('ALTER TABLE documents ADD COLUMN storage_path_id INTEGER REFERENCES storage_paths(id) ON DELETE SET NULL;');
      } catch (e) {
        // column may already exist
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_docs_deleted_at ON documents(deleted_at);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_docs_storage_path ON documents(storage_path_id);');

      // 2. Storage Paths Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS storage_paths (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          path_template TEXT NOT NULL,
          matching_algorithm TEXT DEFAULT 'auto',
          match_pattern TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 3. Saved Views Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          show_on_dashboard INTEGER DEFAULT 0,
          show_in_sidebar INTEGER DEFAULT 1,
          sort_field TEXT DEFAULT 'created_date',
          sort_reverse INTEGER DEFAULT 1,
          filter_rules_json TEXT,
          view_mode TEXT DEFAULT 'grid',
          created_at TEXT NOT NULL
        );
      `);

      // 4. Workflows Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          trigger_type TEXT DEFAULT 'consumption',
          criteria_json TEXT,
          actions_json TEXT,
          is_active INTEGER DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);

      // 5. App Tasks Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_type TEXT NOT NULL,
          status TEXT NOT NULL,
          document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
          message TEXT,
          created_at TEXT NOT NULL,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON app_tasks(status);
      `);

      // 6. App Logs Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT DEFAULT 'INFO',
          source TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_logs_created_at ON app_logs(created_at);
      `);

      // 7. Local Users Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS local_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT,
          email TEXT,
          role TEXT DEFAULT 'admin',
          created_at TEXT NOT NULL
        );
      `);

      // 8. Seed Initial Data for Restored Entities
      const insertUser = db.prepare('INSERT OR IGNORE INTO local_users (id, username, display_name, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      insertUser.run(1, 'nasadmin', 'مدير النظام (nasadmin)', 'nasadmin@nasarchive.local', 'admin', now);

      const insertStoragePath = db.prepare('INSERT OR IGNORE INTO storage_paths (id, name, path_template, created_at) VALUES (?, ?, ?, ?)');
      insertStoragePath.run(1, 'المستودع الرئيسي - حسب القسم والتاريخ', '{department}/{created_year}/{title}', now);

      const insertSavedView = db.prepare('INSERT OR IGNORE INTO saved_views (id, name, show_on_dashboard, show_in_sidebar, sort_field, sort_reverse, filter_rules_json, view_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      insertSavedView.run(1, 'كافة المستندات', 0, 1, 'created_date', 1, '{}', 'grid', now);
      insertSavedView.run(2, 'بانتظار المراجعة', 1, 1, 'created_date', 1, '{"inbox_only":true}', 'grid', now);
      insertSavedView.run(3, 'الكتب الواردة', 0, 1, 'created_date', 1, '{"document_type_id":1}', 'table', now);
      insertSavedView.run(4, 'المستندات المعتمدة للمزامنة', 0, 0, 'created_date', 1, '{"is_approved_for_sync":true}', 'list', now);

      const insertWorkflow = db.prepare('INSERT OR IGNORE INTO workflows (id, name, trigger_type, criteria_json, actions_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insertWorkflow.run(1, 'التصنيف التلقائي لكتب الرنين', 'consumption', JSON.stringify({ title_contains: 'الرنين' }), JSON.stringify({ add_tag: 'الرنين' }), 1, now);
      insertWorkflow.run(2, 'التصنيف التلقائي للكتب الشخصية', 'consumption', JSON.stringify({ title_contains: 'شخصي' }), JSON.stringify({ add_tag: 'شخصي' }), 1, now);

      // Initial system log
      const insertLog = db.prepare('INSERT INTO app_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)');
      insertLog.run('INFO', 'Engine', 'تمت ترقية مخطط قاعدة البيانات إلى الإصدار 2 واستعادة وظائف الأرشيف بنجاح.', now);
    },
    down: (db) => {
      db.exec('DROP TABLE IF EXISTS local_users;');
      db.exec('DROP TABLE IF EXISTS app_logs;');
      db.exec('DROP TABLE IF EXISTS app_tasks;');
      db.exec('DROP TABLE IF EXISTS workflows;');
      db.exec('DROP TABLE IF EXISTS saved_views;');
      db.exec('DROP TABLE IF EXISTS storage_paths;');
    },
  },
];

module.exports = {
  MIGRATIONS,
};
