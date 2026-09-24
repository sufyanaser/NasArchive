/**
 * NAS Archive — Local SQLite Database Manager
 * Uses node:sqlite DatabaseSync with WAL mode, foreign keys, transactions, and migration runner.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { MIGRATIONS } = require('./schema');

class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  /**
   * Initialize and connect to the SQLite database.
   * Runs PRAGMAs and applies pending migrations.
   */
  initialize(databasePath) {
    if (this.db) return this.db;

    this.dbPath = databasePath;
    const dir = path.dirname(databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(databasePath);

    // Essential SQLite performance and integrity PRAGMAs
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    this._runMigrations();
    return this.db;
  }

  /**
   * Run versioned migrations inside a transaction.
   */
  _runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = this.db.prepare('SELECT version FROM schema_migrations').all();
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        // Pre-migration verified backup
        try {
          if (this.dbPath && fs.existsSync(this.dbPath)) {
            const backupDir = path.join(path.dirname(this.dbPath), 'pre_migration_backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, `db_v${migration.version}_${Date.now()}.sqlite`);
            fs.copyFileSync(this.dbPath, backupPath);
          }
        } catch (backupErr) {
          console.warn('[DatabaseManager] Pre-migration backup warning:', backupErr.message);
        }

        // Execute migration
        migration.up(this.db);
        const stmt = this.db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)');
        stmt.run(migration.version, migration.description, new Date().toISOString());
      }
    }
  }

  /**
   * Get direct handle to the database.
   */
  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize(path) first.');
    }
    return this.db;
  }

  /**
   * Execute a function within a database transaction.
   */
  transaction(fn) {
    const db = this.getDb();
    db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn(db);
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Performs SQLite integrity check.
   */
  checkIntegrity() {
    const db = this.getDb();
    const rows = db.prepare('PRAGMA integrity_check;').all();
    const isOk = rows.length === 1 && rows[0].integrity_check === 'ok';
    return { ok: isOk, details: rows };
  }

  /**
   * Safely create a backup copy of the database.
   */
  backup(destPath) {
    const db = this.getDb();
    // Flush WAL to main database file before copying
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(this.dbPath, destPath);
    return true;
  }

  /**
   * Close the database safely.
   */
  close() {
    if (this.db) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        this.db.close();
      } catch (e) {
        // Ignore on shutdown
      }
      this.db = null;
    }
  }
}

module.exports = new DatabaseManager();
