"""Unit tests for Paperless -> Google Drive -> Sheets sync contract and idempotency."""
import json
from pathlib import Path
import tempfile
import unittest

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from sync_validator import (
    compute_approved_hash,
    format_sheets_row,
    validate_for_publication,
    ValidationError,
)
from sync_ledger import SyncLedger
from sync_engine import SyncEngine, DriveClientInterface, SheetsClientInterface


class MockDriveClient(DriveClientInterface):
    def __init__(self):
        self.files_by_sync_key = {}
        self.upload_calls = 0

    def find_file_by_sync_key(self, sync_key: str):
        return self.files_by_sync_key.get(sync_key)

    def upload_file(self, sync_key: str, filename: str, content: bytes, folder_path: str):
        self.upload_calls += 1
        file_id = f'drive_file_{self.upload_calls}'
        file_url = f'https://drive.google.com/file/d/{file_id}/view'
        record = {'file_id': file_id, 'web_view_link': file_url, 'filename': filename}
        self.files_by_sync_key[sync_key] = record
        return record


class MockSheetsClient(SheetsClientInterface):
    def __init__(self):
        self.rows_by_sync_key = {}
        self.upsert_calls = 0
        self.fail_next = False

    def upsert_row(self, sync_key: str, row_values: list):
        if self.fail_next:
            raise RuntimeError('Simulated Sheets API 503 Service Unavailable')
        self.upsert_calls += 1
        row_id = f'row_{len(self.rows_by_sync_key) + 1}'
        self.rows_by_sync_key[sync_key] = (row_id, row_values)
        return row_id


class SyncContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / 'ledger.db'
        self.ledger = SyncLedger(self.db_path)
        self.drive = MockDriveClient()
        self.sheets = MockSheetsClient()
        self.engine = SyncEngine(
            instance_id='nas-prod',
            paperless_base_url='http://localhost:8000',
            ledger=self.ledger,
            drive_client=self.drive,
            sheets_client=self.sheets,
        )

        # Catalog maps
        self.tags = {
            1: 'شخصي',
            2: 'الرنين',
            3: 'تناسق',
            4: 'NAS FM',
            5: 'بانتظار المراجعة',
        }
        self.doc_types = {
            1: 'كتاب وارد',
            2: 'كتاب صادر',
            3: 'كتاب داخلي',
        }
        self.fields = {
            1: 'رقم الكتاب',
            2: 'الجهة المرسلة',
            3: 'الجهة المستلمة',
            4: 'تاريخ الورود',
            5: 'رقم القيد',
            6: 'الكتاب المرجعي',
            7: 'ملاحظات',
            8: 'معتمد للمزامنة',
            9: 'راجعه',
            10: 'تاريخ المراجعة',
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def _valid_doc(self):
        return {
            'id': 42,
            'title': 'مذكرة تفاهم سنوية',
            'created': '2026-09-23T10:00:00Z',
            'document_type': 1,
            'tags': [2],  # 'الرنين'
            'custom_fields': [
                {'field': 1, 'value': '0042/ص-2026'},
                {'field': 2, 'value': 'وزارة التجارة'},
                {'field': 3, 'value': 'شركة الرنين'},
                {'field': 4, 'value': '2026-09-23'},
                {'field': 5, 'value': '00987-ق'},
                {'field': 7, 'value': 'ملاحظات تدقيق'},
                {'field': 8, 'value': True},
                {'field': 9, 'value': 'سفيان'},
                {'field': 10, 'value': '2026-09-23'},
            ],
        }

    def test_unapproved_document_rejected(self):
        doc = self._valid_doc()
        # Set 'معتمد للمزامنة' to False
        for cf in doc['custom_fields']:
            if cf['field'] == 8:
                cf['value'] = False

        with self.assertRaisesRegex(ValidationError, 'not approved'):
            self.engine.sync_document(doc, b'PDF_CONTENT', self.tags, self.doc_types, self.fields)
        self.assertEqual(self.drive.upload_calls, 0)
        self.assertEqual(self.sheets.upsert_calls, 0)

    def test_inbox_tag_prevents_sync(self):
        doc = self._valid_doc()
        doc['tags'].append(5)  # add 'بانتظار المراجعة'
        with self.assertRaisesRegex(ValidationError, 'inbox tag'):
            self.engine.sync_document(doc, b'PDF_CONTENT', self.tags, self.doc_types, self.fields)

    def test_missing_or_multiple_sections_rejected(self):
        # No section
        doc1 = self._valid_doc()
        doc1['tags'] = []
        with self.assertRaisesRegex(ValidationError, 'exactly one section'):
            self.engine.sync_document(doc1, b'PDF_CONTENT', self.tags, self.doc_types, self.fields)

        # Multiple sections
        doc2 = self._valid_doc()
        doc2['tags'] = [1, 2]  # شخصي and الرنين
        with self.assertRaisesRegex(ValidationError, 'exactly one section'):
            self.engine.sync_document(doc2, b'PDF_CONTENT', self.tags, self.doc_types, self.fields)

    def test_missing_required_fields_rejected(self):
        doc = self._valid_doc()
        # Remove 'راجعه'
        doc['custom_fields'] = [cf for cf in doc['custom_fields'] if cf['field'] != 9]
        with self.assertRaisesRegex(ValidationError, 'missing required field: "راجعه"'):
            self.engine.sync_document(doc, b'PDF_CONTENT', self.tags, self.doc_types, self.fields)

    def test_successful_clean_sync_and_sheet_format(self):
        doc = self._valid_doc()
        res = self.engine.sync_document(doc, b'%PDF-1.4 test content', self.tags, self.doc_types, self.fields)
        self.assertEqual(res['status'], 'SUCCESS')
        self.assertEqual(res['sync_key'], 'nas-prod:42')
        self.assertEqual(self.drive.upload_calls, 1)
        self.assertEqual(self.sheets.upsert_calls, 1)

        # Verify Sheets row format
        row_id, row = self.sheets.rows_by_sync_key['nas-prod:42']
        self.assertEqual(len(row), 16)
        self.assertEqual(row[0], 'nas-prod:42')          # sync_key
        self.assertEqual(row[1], 'الرنين')                # section
        self.assertEqual(row[2], 'كتاب وارد')            # doc_type
        self.assertEqual(row[3], '0042/ص-2026')          # doc_number preserves leading zeros and slash
        self.assertEqual(row[4], 'مذكرة تفاهم سنوية')    # title / subject
        self.assertEqual(row[5], '2026-09-23')           # doc date
        self.assertEqual(row[6], 'وزارة التجارة')         # sender
        self.assertEqual(row[7], 'شركة الرنين')          # recipient
        self.assertEqual(row[9], '00987-ق')              # entry number
        self.assertEqual(row[10], 'سفيان')               # reviewer
        self.assertEqual(row[11], '2026-09-23')          # review date

        # Verify ledger state
        entry = self.ledger.get_entry('nas-prod:42')
        self.assertEqual(entry['status'], 'SYNCED')
        self.assertIsNotNone(entry['drive_file_id'])
        self.assertIsNotNone(entry['synced_at'])

    def test_idempotent_resync_does_not_duplicate(self):
        doc = self._valid_doc()
        # First sync
        res1 = self.engine.sync_document(doc, b'%PDF-1.4 test content', self.tags, self.doc_types, self.fields)
        self.assertEqual(res1['status'], 'SUCCESS')
        self.assertEqual(self.drive.upload_calls, 1)
        self.assertEqual(self.sheets.upsert_calls, 1)

        # Second sync with exact same data
        res2 = self.engine.sync_document(doc, b'%PDF-1.4 test content', self.tags, self.doc_types, self.fields)
        self.assertEqual(res2['status'], 'ALREADY_SYNCED')
        # Calls MUST remain at 1
        self.assertEqual(self.drive.upload_calls, 1)
        self.assertEqual(self.sheets.upsert_calls, 1)

    def test_sheet_failure_resumes_without_reuploading_to_drive(self):
        doc = self._valid_doc()
        # Simulate Sheets failure
        self.sheets.fail_next = True
        with self.assertRaisesRegex(RuntimeError, 'Simulated Sheets API'):
            self.engine.sync_document(doc, b'%PDF-1.4 test content', self.tags, self.doc_types, self.fields)

        # Drive was uploaded, but Sheets failed
        self.assertEqual(self.drive.upload_calls, 1)
        self.assertEqual(self.sheets.upsert_calls, 0)
        entry = self.ledger.get_entry('nas-prod:42')
        self.assertEqual(entry['status'], 'DRIVE_UPLOADED')
        saved_file_id = entry['drive_file_id']
        self.assertIsNotNone(saved_file_id)

        # Next attempt: Sheets is working now
        self.sheets.fail_next = False
        res = self.engine.sync_document(doc, b'%PDF-1.4 test content', self.tags, self.doc_types, self.fields)
        self.assertEqual(res['status'], 'SUCCESS')
        # Drive upload calls MUST NOT increase! Drive upload was skipped and reused!
        self.assertEqual(self.drive.upload_calls, 1)
        self.assertEqual(self.sheets.upsert_calls, 1)
        self.assertEqual(res['drive_file_id'], saved_file_id)

    def test_post_approval_change_requires_reapproval(self):
        doc = self._valid_doc()
        # First sync
        self.engine.sync_document(doc, b'%PDF-1.4 original', self.tags, self.doc_types, self.fields)

        # Someone modified the PDF content or metadata after approval
        with self.assertRaisesRegex(ValidationError, 'modified after previous sync'):
            self.engine.sync_document(doc, b'%PDF-1.4 TAMPERED/CHANGED', self.tags, self.doc_types, self.fields)

    def test_pre_upload_drive_search_prevents_duplicate_file(self):
        doc = self._valid_doc()
        # Pre-populate Drive mock as if previous network timeout orphaned a file
        self.drive.files_by_sync_key['nas-prod:42'] = {
            'file_id': 'pre_existing_drive_id',
            'web_view_link': 'https://drive.google.com/file/d/pre_existing_drive_id/view',
        }
        res = self.engine.sync_document(doc, b'%PDF-1.4', self.tags, self.doc_types, self.fields)
        self.assertEqual(res['status'], 'SUCCESS')
        self.assertEqual(res['drive_file_id'], 'pre_existing_drive_id')
        # upload_file should NOT have been called because find_file_by_sync_key found the orphan
        self.assertEqual(self.drive.upload_calls, 0)


if __name__ == '__main__':
    unittest.main()
