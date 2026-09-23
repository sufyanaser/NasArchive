"""Automated unit and security tests for NAS Archive Local Scanner Bridge."""
import base64
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

import scanner_bridge
from scanner_bridge import ScannerBridgeHandler, sanitize_filename


class ScannerBridgeTests(unittest.TestCase):
    """Test suite for Local Scanner Bridge endpoints and security invariants."""

    @classmethod
    def setUpClass(cls):
        """Spin up a test instance of ScannerBridge on an ephemeral local port."""
        cls.test_host = '127.0.0.1'
        # Bind to port 0 to let OS assign an available local port
        cls.httpd = ThreadingHTTPServer((cls.test_host, 0), ScannerBridgeHandler)
        cls.test_port = cls.httpd.server_port
        cls.base_url = f'http://{cls.test_host}:{cls.test_port}'

        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        """Shutdown the test bridge server."""
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _request(self, path: str, method: str = 'GET', data: dict = None):
        """Helper to send HTTP request to test bridge."""
        url = f'{self.base_url}{path}'
        req_data = json.dumps(data).encode('utf-8') if data else None
        headers = {'Content-Type': 'application/json'} if req_data else {}
        req = Request(url, data=req_data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=5) as resp:
                body = resp.read().decode('utf-8')
                return resp.status, resp.headers, body
        except HTTPError as err:
            err_body = err.read().decode('utf-8')
            return err.code, err.headers, err_body

    def test_web_ui_served(self):
        """Verify root endpoint serves the Arabic Scanner UI."""
        status, headers, body = self._request('/')
        self.assertEqual(status, 200)
        self.assertIn('text/html', headers.get('Content-Type', ''))
        self.assertIn('NAS Archive', body)
        self.assertIn('الماسح الضوئي', body)
        self.assertIn('dir="rtl"', body)

    def test_status_endpoint(self):
        """Verify /api/status returns health and device info."""
        status, _, body = self._request('/api/status')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data.get('status'), 'HEALTHY')
        self.assertIn('paperless', data)
        self.assertIn('scanner', data)
        self.assertIn('version', data)
        self.assertTrue(data['scanner']['naps2_installed'])

    def test_devices_endpoint(self):
        """Verify /api/devices returns device list and allowable choices."""
        status, _, body = self._request('/api/devices?driver=wia')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertIn('devices', data)
        self.assertIn('sources', data)
        self.assertIn('sections', data)
        self.assertIn('dpis', data)
        self.assertIn('bitdepths', data)
        self.assertIn('شخصي', data['sections'])
        self.assertIn('الرنين', data['sections'])
        self.assertIn(300, data['dpis'])

    def test_scan_invalid_section_rejected(self):
        """Security: reject scan requests targeting non-whitelisted sections."""
        payload = {
            'section': 'UnknownHackedSection',
            'driver': 'wia',
            'dpi': 300,
        }
        status, _, body = self._request('/api/scan', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('Invalid section', data.get('error', ''))

    def test_scan_invalid_driver_rejected(self):
        """Security: reject scan requests with unauthorized driver."""
        payload = {
            'section': 'شخصي',
            'driver': 'malicious_driver; rm -rf',
            'dpi': 300,
        }
        status, _, body = self._request('/api/scan', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('Invalid driver', data.get('error', ''))

    def test_scan_invalid_dpi_rejected(self):
        """Security: reject arbitrary DPI values outside allowlist."""
        payload = {
            'section': 'شخصي',
            'driver': 'wia',
            'dpi': 999999,
        }
        status, _, body = self._request('/api/scan', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('Invalid dpi', data.get('error', ''))

    def test_scan_shell_injection_device_rejected(self):
        """Security: reject device names containing command injection characters."""
        payload = {
            'section': 'شخصي',
            'device': 'Scanner & powershell -Command calc.exe',
            'driver': 'wia',
            'dpi': 300,
        }
        status, _, body = self._request('/api/scan', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('illegal shell characters', data.get('error', ''))

    def test_filename_sanitization_prevents_path_traversal(self):
        """Security: sanitize_filename strips path traversal sequences."""
        self.assertEqual(sanitize_filename('../../etc/passwd.pdf'), 'passwd.pdf')
        self.assertEqual(sanitize_filename(r'..\..\Windows\System32\cmd.exe.pdf'), 'cmd.exe.pdf')
        self.assertEqual(sanitize_filename('nested/dir/my_doc.pdf'), 'my_doc.pdf')
        # Arabic filenames preserved
        self.assertIn('كتاب_رسمي', sanitize_filename('كتاب رسمي 2026.pdf'))

    def test_import_corrupted_header_rejected(self):
        """Security: reject uploaded file claiming to be PDF without %PDF header."""
        fake_content = b'THIS IS NOT A VALID PDF FILE'
        payload = {
            'filename': 'fake.pdf',
            'section': 'شخصي',
            'file_data': base64.b64encode(fake_content).decode('ascii'),
        }
        status, _, body = self._request('/api/import', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('lacks valid signature header', data.get('error', ''))

    def test_import_empty_file_rejected(self):
        """Security: reject empty files."""
        payload = {
            'filename': 'empty.pdf',
            'section': 'شخصي',
            'file_data': base64.b64encode(b'').decode('ascii'),
        }
        status, _, body = self._request('/api/import', method='POST', data=payload)
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertIn('empty', data.get('error', ''))

    def test_import_valid_pdf_enqueues_task(self):
        """Verify valid PDF file upload enqueues task and returns 202."""
        valid_pdf_content = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'
        payload = {
            'filename': 'unit_test_doc.pdf',
            'section': 'شخصي',
            'file_data': base64.b64encode(valid_pdf_content).decode('ascii'),
            'allow_duplicate': True,
        }
        status, _, body = self._request('/api/import', method='POST', data=payload)
        self.assertEqual(status, 202)
        data = json.loads(body)
        self.assertEqual(data.get('status'), 'QUEUED')
        self.assertIn('task_id', data)

        task_id = data['task_id']
        # Query task status
        t_status, _, t_body = self._request(f'/api/tasks/{task_id}')
        self.assertEqual(t_status, 200)
        task_data = json.loads(t_body)
        self.assertEqual(task_data.get('task_id'), task_id)
        self.assertEqual(task_data.get('type'), 'import')


if __name__ == '__main__':
    unittest.main()
