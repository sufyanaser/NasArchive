"""Persistent SQLite-backed sync ledger preventing duplicate uploads and enabling step resumption."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from typing import Any, Dict, Optional


class SyncLedger:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._connect() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sync_ledger (
                    sync_key TEXT PRIMARY KEY,
                    instance_id TEXT NOT NULL,
                    document_id INTEGER NOT NULL,
                    approved_hash TEXT NOT NULL,
                    section TEXT NOT NULL,
                    drive_file_id TEXT,
                    drive_file_url TEXT,
                    sheet_row_key TEXT,
                    status TEXT NOT NULL,
                    attempts INTEGER DEFAULT 0,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    synced_at TEXT
                )
            ''')
            conn.commit()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_entry(self, sync_key: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            cur = conn.execute('SELECT * FROM sync_ledger WHERE sync_key = ?', (sync_key,))
            row = cur.fetchone()
            return dict(row) if row else None

    def register_attempt(self, sync_key: str, instance_id: str, doc_id: int,
                         approved_hash: str, section: str) -> Dict[str, Any]:
        """Register or lock a document for synchronization attempt."""
        now = self._now_iso()
        with self._connect() as conn:
            cur = conn.execute('SELECT * FROM sync_ledger WHERE sync_key = ?', (sync_key,))
            row = cur.fetchone()
            if row is None:
                conn.execute('''
                    INSERT INTO sync_ledger (
                        sync_key, instance_id, document_id, approved_hash, section,
                        status, attempts, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'PENDING', 1, ?, ?)
                ''', (sync_key, instance_id, doc_id, approved_hash, section, now, now))
            else:
                existing = dict(row)
                if existing['approved_hash'] != approved_hash:
                    # Content/metadata changed! Requires re-approval
                    conn.execute('''
                        UPDATE sync_ledger SET
                            approved_hash = ?,
                            status = 'NEEDS_REAPPROVAL',
                            attempts = attempts + 1,
                            last_error = 'Content or metadata changed after previous approval',
                            updated_at = ?
                        WHERE sync_key = ?
                    ''', (approved_hash, now, sync_key))
                else:
                    conn.execute('''
                        UPDATE sync_ledger SET
                            attempts = attempts + 1,
                            updated_at = ?
                        WHERE sync_key = ?
                    ''', (now, sync_key))
            conn.commit()
        return self.get_entry(sync_key)

    def record_drive_success(self, sync_key: str, drive_file_id: str, drive_file_url: str):
        """Record successful Drive upload before attempting Sheets."""
        now = self._now_iso()
        with self._connect() as conn:
            conn.execute('''
                UPDATE sync_ledger SET
                    drive_file_id = ?,
                    drive_file_url = ?,
                    status = 'DRIVE_UPLOADED',
                    updated_at = ?
                WHERE sync_key = ?
            ''', (drive_file_id, drive_file_url, now, sync_key))
            conn.commit()

    def record_sheet_success(self, sync_key: str, sheet_row_key: str):
        """Record final sync success after Sheets update."""
        now = self._now_iso()
        with self._connect() as conn:
            conn.execute('''
                UPDATE sync_ledger SET
                    sheet_row_key = ?,
                    status = 'SYNCED',
                    last_error = NULL,
                    updated_at = ?,
                    synced_at = ?
                WHERE sync_key = ?
            ''', (sheet_row_key, now, now, sync_key))
            conn.commit()

    def record_failure(self, sync_key: str, error_message: str):
        """Record step failure with error message."""
        now = self._now_iso()
        with self._connect() as conn:
            conn.execute('''
                UPDATE sync_ledger SET
                    status = CASE
                        WHEN status = 'DRIVE_UPLOADED' THEN 'DRIVE_UPLOADED'
                        ELSE 'FAILED'
                    END,
                    last_error = ?,
                    updated_at = ?
                WHERE sync_key = ?
            ''', (error_message, now, sync_key))
            conn.commit()

    def can_resume_sheets_only(self, sync_key: str, current_hash: str) -> bool:
        """Check if Drive upload is already complete with matching hash, so only Sheets needs retry."""
        entry = self.get_entry(sync_key)
        if not entry:
            return False
        return (
            entry.get('status') == 'DRIVE_UPLOADED'
            and bool(entry.get('drive_file_id'))
            and entry.get('approved_hash') == current_hash
        )

    def is_already_synced(self, sync_key: str, current_hash: str) -> bool:
        """Check if already successfully synced with matching hash."""
        entry = self.get_entry(sync_key)
        if not entry:
            return False
        return (
            entry.get('status') == 'SYNCED'
            and entry.get('approved_hash') == current_hash
        )
