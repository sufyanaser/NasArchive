"""Unit tests for scanner ingestion, duplicate detection, and file handling."""
from pathlib import Path
import tempfile
import unittest

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

import scanner_ingest


class ScannerIngestTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base = Path(self.temp_dir.name)
        scanner_ingest.STAGING_DIR = self.base / 'staging'
        scanner_ingest.CONSUME_DIR = self.base / 'consume'
        scanner_ingest.ARCHIVE_DIR = self.base / 'archive'

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_naps2_found(self):
        exe = scanner_ingest.find_naps2_executable()
        self.assertIsNotNone(exe, 'NAPS2.Console.exe should be detected on the system')

    def test_ingest_empty_file_rejected(self):
        empty_file = self.base / 'empty.pdf'
        empty_file.write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'empty'):
            scanner_ingest.ingest_file(empty_file, section='شخصي')

    def test_ingest_corrupted_pdf_rejected(self):
        corrupt_file = self.base / 'corrupt.pdf'
        corrupt_file.write_bytes(b'NOT_A_PDF_CONTENT')
        with self.assertRaisesRegex(ValueError, '%PDF header'):
            scanner_ingest.ingest_file(corrupt_file, section='شخصي')

    def test_ingest_invalid_section_rejected(self):
        valid_pdf = self.base / 'valid.pdf'
        valid_pdf.write_bytes(b'%PDF-1.4 sample content')
        with self.assertRaisesRegex(ValueError, 'Invalid section'):
            scanner_ingest.ingest_file(valid_pdf, section='قسم_غير_موجود')

    def test_successful_ingest_and_archive_preservation(self):
        sample_pdf = self.base / 'doc1.pdf'
        sample_pdf.write_bytes(b'%PDF-1.4 clean document')

        res = scanner_ingest.ingest_file(sample_pdf, section='الرنين')
        self.assertEqual(res['status'], 'INGESTED')
        self.assertEqual(res['section'], 'الرنين')

        # Check preserved in archive
        self.assertTrue(Path(res['archived_copy']).exists())
        self.assertEqual(Path(res['archived_copy']).read_bytes(), b'%PDF-1.4 clean document')

        # Check in consume target
        consume_target = Path(res['consume_target'])
        self.assertTrue(consume_target.exists())
        self.assertEqual(consume_target.read_bytes(), b'%PDF-1.4 clean document')
        self.assertEqual(consume_target.parent.name, 'الرنين')

    def test_duplicate_detection(self):
        sample_pdf = self.base / 'doc2.pdf'
        sample_pdf.write_bytes(b'%PDF-1.4 duplicate test content')

        # First ingest succeeds
        res1 = scanner_ingest.ingest_file(sample_pdf, section='تناسق')
        self.assertEqual(res1['status'], 'INGESTED')

        # Second ingest with same content should be rejected as duplicate
        another_file = self.base / 'doc2_copy.pdf'
        another_file.write_bytes(b'%PDF-1.4 duplicate test content')
        res2 = scanner_ingest.ingest_file(another_file, section='تناسق', allow_duplicate=False)
        self.assertEqual(res2['status'], 'DUPLICATE_REJECTED')
        self.assertIn('exact duplicate', res2['message'])

        # With allow_duplicate=True, it succeeds
        res3 = scanner_ingest.ingest_file(another_file, section='تناسق', allow_duplicate=True)
        self.assertEqual(res3['status'], 'INGESTED')


if __name__ == '__main__':
    unittest.main()
