"""Unit test verifying the end-to-end lifecycle orchestration contract."""
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from ai_processor import ArabicDocumentAnalyzer
from google_cloud_adapter import DryRunDriveClient, DryRunSheetsClient
import scanner_ingest
from sync_engine import SyncEngine
from sync_ledger import SyncLedger
from sync_validator import format_sheets_row, validate_for_publication


class LifecycleContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base = Path(self.temp_dir.name)
        scanner_ingest.STAGING_DIR = self.base / 'staging'
        scanner_ingest.CONSUME_DIR = self.base / 'consume'
        scanner_ingest.ARCHIVE_DIR = self.base / 'archive'
        self.ledger = SyncLedger(self.base / 'ledger.db')

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_full_pipeline_contract(self):
        # 1. Scanned Document Stage
        doc_file = self.base / 'scanned_contract.pdf'
        doc_file.write_bytes(b'%PDF-1.4 sample scanned contract text')
        ingest_res = scanner_ingest.ingest_file(doc_file, section='تناسق')
        self.assertEqual(ingest_res['status'], 'INGESTED')
        self.assertTrue(Path(ingest_res['archived_copy']).exists())

        # 2. AI Analysis on OCR text
        ocr_text = """
        وزارة الإعمار والإسكان
        العدد: 0099/ص-2026
        التاريخ: 2026-09-23
        الموضوع: مشروع تصميم وتنفيذ
        من: المديرية العامة
        إلى: وكالة تناسق
        رقم القيد: 00888-ق
        """
        analysis = ArabicDocumentAnalyzer.analyze_document(doc_id=10, content=ocr_text, title='مشروع')
        self.assertEqual(analysis.doc_number_suggestion.value, '0099/ص-2026')
        self.assertEqual(analysis.department_suggestion.value, 'تناسق')
        self.assertFalse(analysis.ai_approved_sync)

        # 3. Human Review & Approval
        doc_dict = {
            'id': 10,
            'title': analysis.title_suggestion.value,
            'created': '2026-09-23',
            'document_type': 1,
            'tags': [3],  # 'تناسق' (no inbox tag)
            'custom_fields': [
                {'field': 1, 'value': '0099/ص-2026'},
                {'field': 2, 'value': 'المديرية العامة'},
                {'field': 3, 'value': 'وكالة تناسق'},
                {'field': 4, 'value': '2026-09-23'},
                {'field': 5, 'value': '00888-ق'},
                {'field': 8, 'value': True},  # EXPLICIT HUMAN APPROVAL
                {'field': 9, 'value': 'سفيان'},
                {'field': 10, 'value': '2026-09-23'},
            ],
        }

        # 4. Sync Execution
        drive_client = DryRunDriveClient()
        sheets_client = DryRunSheetsClient()
        engine = SyncEngine(
            instance_id='nas-prod',
            paperless_base_url='http://localhost:8000',
            ledger=self.ledger,
            drive_client=drive_client,
            sheets_client=sheets_client,
        )

        catalog_tags = {3: 'تناسق', 5: 'بانتظار المراجعة'}
        catalog_doc_types = {1: 'كتاب وارد'}
        catalog_fields = {
            1: 'رقم الكتاب',
            2: 'الجهة المرسلة',
            3: 'الجهة المستلمة',
            4: 'تاريخ الورود',
            5: 'رقم القيد',
            8: 'معتمد للمزامنة',
            9: 'راجعه',
            10: 'تاريخ المراجعة',
        }

        sync_res = engine.sync_document(
            doc_dict=doc_dict,
            file_bytes=b'%PDF-1.4 file content',
            catalog_tags=catalog_tags,
            catalog_doc_types=catalog_doc_types,
            catalog_fields=catalog_fields,
        )
        self.assertEqual(sync_res['status'], 'SUCCESS')
        self.assertEqual(sync_res['sync_key'], 'nas-prod:10')

        # 5. Idempotent Resync
        resync = engine.sync_document(
            doc_dict=doc_dict,
            file_bytes=b'%PDF-1.4 file content',
            catalog_tags=catalog_tags,
            catalog_doc_types=catalog_doc_types,
            catalog_fields=catalog_fields,
        )
        self.assertEqual(resync['status'], 'ALREADY_SYNCED')


if __name__ == '__main__':
    unittest.main()
