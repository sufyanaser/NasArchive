"""Local Scanner Bridge & Web Gateway for NAS Archive.
Provides an Arabic-first Web UI and secure REST API to control NAPS2,
execute physical scans or manual file imports, and track Paperless-ngx ingestion.
Bound strictly to 127.0.0.1.
"""
import base64
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import threading
import time
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Internal modules
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

import scanner_ingest
from ai_processor import ArabicDocumentAnalyzer

RUNTIME_DIR = ROOT / 'runtime'
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = RUNTIME_DIR / 'scanner_bridge.log'

log_handlers = [logging.FileHandler(str(LOG_FILE), encoding='utf-8')]
if sys.stderr is not None:
    log_handlers.append(logging.StreamHandler(sys.stderr))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [ScannerBridge] %(message)s',
    handlers=log_handlers
)
logger = logging.getLogger(__name__)

HOST = '127.0.0.1'
PORT = 8001
PAPERLESS_BASE_URL = 'http://127.0.0.1:8000'

WEB_DIR = ROOT / 'web'
INDEX_HTML = WEB_DIR / 'index.html'
STAGING_DIR = RUNTIME_DIR / 'staging'
TOKEN_FILE = RUNTIME_DIR / 'api_token.txt'
ADMIN_LOGIN_FILE = RUNTIME_DIR / 'admin-login.json'

VALID_DRIVERS = ('wia', 'twain', 'escl')
VALID_SOURCES = ('glass', 'feeder', 'duplex')
VALID_BITDEPTHS = ('color', 'gray', 'bw')
VALID_DPIS = (150, 200, 300, 400, 600)

TASKS: Dict[str, Dict[str, Any]] = {}
TASKS_LOCK = threading.Lock()

CACHED_DEVICES: List[str] = []
LAST_DEVICE_CHECK_TIME: float = 0.0


def refresh_devices_cache():
    """Background scanner device discovery that never blocks status health checks."""
    global CACHED_DEVICES, LAST_DEVICE_CHECK_TIME
    try:
        naps2_path = scanner_ingest.find_naps2_executable()
        if naps2_path:
            wia_devs = scanner_ingest.list_scanning_devices('wia').get('wia', [])
            CACHED_DEVICES = [d for d in wia_devs if not d.startswith('Error:')]
            LAST_DEVICE_CHECK_TIME = time.monotonic()
            logger.info('Device discovery complete. Found: %s', CACHED_DEVICES)
    except Exception as exc:
        logger.debug('Device refresh error: %s', exc)


def get_cached_devices() -> List[str]:
    """Return currently discovered devices immediately."""
    return list(CACHED_DEVICES)


def get_paperless_token() -> Optional[str]:
    """Retrieve or refresh cached DRF authentication token for Paperless."""
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding='utf-8').strip()
        if token:
            return token

    if not ADMIN_LOGIN_FILE.exists():
        logger.warning('Missing admin-login.json; cannot authenticate with Paperless API')
        return None

    try:
        creds = json.loads(ADMIN_LOGIN_FILE.read_text(encoding='utf-8'))
        payload = json.dumps({'username': creds['username'], 'password': creds['password']}).encode('utf-8')
        req = Request(
            f'{PAPERLESS_BASE_URL}/api/token/',
            data=payload,
            headers={'Content-Type': 'application/json'}
        )
        with urlopen(req, timeout=10) as resp:
            data = json.load(resp)
            token = data.get('token')
            if token:
                TOKEN_FILE.write_text(token, encoding='utf-8')
                return token
    except Exception as exc:
        logger.error('Failed to obtain Paperless API token: %s', exc)

    return None


def query_paperless(endpoint: str, method: str = 'GET', data: Optional[Dict] = None) -> Optional[Dict]:
    """Query Paperless REST API with authentication."""
    token = get_paperless_token()
    url = f"{PAPERLESS_BASE_URL.rstrip('/')}/api/{endpoint.lstrip('/')}"
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Token {token}'

    req_data = json.dumps(data).encode('utf-8') if data else None
    req = Request(url, data=req_data, headers=headers, method=method)

    try:
        with urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get('Content-Type', '')
            if 'application/json' in content_type:
                return json.load(resp)
            return {'status_code': resp.status}
    except HTTPError as http_err:
        if http_err.code == 401 and TOKEN_FILE.exists():
            # Invalidate stale token and retry once
            TOKEN_FILE.unlink(missing_ok=True)
            token = get_paperless_token()
            if token:
                headers['Authorization'] = f'Token {token}'
                retry_req = Request(url, data=req_data, headers=headers, method=method)
                with urlopen(retry_req, timeout=15) as resp:
                    return json.load(resp)
        logger.debug('Paperless API HTTP %d for %s: %s', http_err.code, endpoint, http_err.reason)
        return None
    except Exception as exc:
        logger.debug('Paperless API connection error for %s: %s', endpoint, exc)
        return None


def check_paperless_online() -> bool:
    """Verify if Paperless server is responsive."""
    try:
        req = Request(f'{PAPERLESS_BASE_URL}/', method='HEAD')
        with urlopen(req, timeout=3) as resp:
            return resp.status in (200, 301, 302)
    except Exception:
        return False


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and invalid characters."""
    base = os.path.basename(filename).strip()
    safe = re.sub(r'[^a-zA-Z0-9_\-\.\u0600-\u06FF]', '_', base)
    if not safe or safe.startswith('.'):
        safe = f"upload_{int(time.time())}.pdf"
    return safe


def poll_paperless_consumption(target_filename: str, timeout_seconds: int = 120) -> Optional[Dict[str, Any]]:
    """Poll Paperless tasks API until document consumption completes."""
    deadline = time.monotonic() + timeout_seconds
    stem = Path(target_filename).stem
    matched_doc_id = None

    while time.monotonic() < deadline:
        tasks_res = query_paperless('tasks/?task_type=consume_file')
        if tasks_res and 'results' in tasks_res:
            for task in tasks_res['results']:
                fn = task.get('input_data', {}).get('filename', '')
                if target_filename in fn or stem in fn:
                    status = task.get('status')
                    if status == 'success':
                        doc_id = task.get('result_data', {}).get('document_id')
                        if not doc_id and task.get('related_document_ids'):
                            doc_id = task['related_document_ids'][0]
                        if doc_id:
                            matched_doc_id = doc_id
                            break
                    elif status == 'failure':
                        err_msg = task.get('result_data', {}).get('message', 'Paperless ingestion task failed')
                        raise RuntimeError(f'فشلت معالجة Paperless: {err_msg}')

        if matched_doc_id:
            break

        # Fallback: check documents directly if filename was renamed
        docs_res = query_paperless('documents/?ordering=-id')
        if docs_res and 'results' in docs_res:
            for doc in docs_res['results'][:10]:
                orig = doc.get('original_file_name') or ''
                title = doc.get('title') or ''
                if target_filename in orig or stem in orig or stem in title:
                    matched_doc_id = doc['id']
                    break

        if matched_doc_id:
            break

        time.sleep(2)

    if not matched_doc_id:
        return None

    # Retrieve full document details
    doc_details = query_paperless(f'documents/{matched_doc_id}/') or {'id': matched_doc_id}
    return doc_details


def background_task_worker(task_id: str, task_type: str, params: Dict[str, Any]):
    """Execute scan, staging, archive, or file import in a background worker thread."""
    section = params.get('section', 'شخصي')
    allow_duplicate = params.get('allow_duplicate', False)

    try:
        if task_type == 'scan_stage':
            # Stage A: Scan to temporary staging for preview without ingesting to Paperless
            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'CONNECTING_SCANNER',
                    'step': 1,
                    'message': 'جاري الاتصال بالماسح الضوئي والتأكد من الجاهزية...',
                })

            device = params.get('device')
            driver = params.get('driver', 'wia')
            source = params.get('source')
            bitdepth = params.get('bitdepth', 'color')
            dpi = params.get('dpi', 300)
            deskew = params.get('deskew', True)

            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'SCANNING',
                    'step': 2,
                    'message': 'جاري سحب ومسح المستند ضوئياً بدقة عالية للمعاينة...',
                })

            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            filename = f"scan_{timestamp}_{section}.pdf"

            staged_res = scanner_ingest.scan_to_staging(
                section=section,
                device=device,
                driver=driver,
                dpi=dpi,
                source=source,
                bitdepth=bitdepth,
                deskew=deskew,
                output_filename=filename
            )

            result_payload = {
                'stage_id': task_id,
                'staging_path': staged_res['staging_path'],
                'filename': staged_res['filename'],
                'size_bytes': staged_res['size_bytes'],
                'sha256': staged_res['sha256'],
                'pages_count': staged_res.get('pages_count', 1),
                'section': section,
                'preview_url': f"/api/staging/{staged_res['filename']}",
            }

            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'STAGED_READY',
                    'step': 2,
                    'message': 'تم مسح المستند بنجاح وجاهز للمعاينة والمراجعة قبل الأرشفة.',
                    'result': result_payload,
                })
            return

        elif task_type == 'scan':
            # Legacy/Direct: Connect, scan, and archive immediately
            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'CONNECTING_SCANNER',
                    'step': 1,
                    'message': 'جاري الاتصال بالماسح الضوئي والتأكد من الجاهزية...',
                })

            device = params.get('device')
            driver = params.get('driver', 'wia')
            source = params.get('source')
            bitdepth = params.get('bitdepth', 'color')
            dpi = params.get('dpi', 300)
            deskew = params.get('deskew', True)

            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'SCANNING',
                    'step': 2,
                    'message': 'جاري سحب ومسح المستند ضوئياً بدقة عالية...',
                })

            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            filename = f"scan_{timestamp}_{section}.pdf"
            staging_path = STAGING_DIR / filename
            STAGING_DIR.mkdir(parents=True, exist_ok=True)

            ingest_res = scanner_ingest.scan_document(
                section=section,
                device=device,
                driver=driver,
                dpi=dpi,
                source=source,
                bitdepth=bitdepth,
                deskew=deskew,
                output_filename=filename
            )

        elif task_type == 'import':
            # Direct file import & archive
            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'PREPARING_FILE',
                    'step': 1,
                    'message': 'جاري التحقق من سلامة الملف والبنية الرقمية...',
                })

            staging_path = Path(params['staging_file'])
            filename = staging_path.name

            ingest_res = scanner_ingest.ingest_file(
                staging_path,
                section=section,
                allow_duplicate=allow_duplicate
            )

        elif task_type == 'archive':
            # Stage B: Explicit archive of an already staged document
            raw_filename = params.get('filename') or params.get('staging_file') or ''
            safe_name = sanitize_filename(raw_filename)
            staging_path = STAGING_DIR / safe_name
            if not staging_path.exists():
                raise FileNotFoundError(f'الملف المؤقت غير موجود: {safe_name}')

            filename = staging_path.name
            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'ARCHIVING',
                    'step': 3,
                    'message': 'جاري حفظ النسخة الخام وفحص البصمة الرقمية (SHA-256)...',
                })

            ingest_res = scanner_ingest.ingest_file(
                staging_path,
                section=section,
                allow_duplicate=allow_duplicate
            )
        else:
            raise ValueError(f'Unknown task type: {task_type}')

        # Step 3: Archive & Duplicate Check
        with TASKS_LOCK:
            TASKS[task_id].update({
                'status': 'ARCHIVING',
                'step': 3,
                'message': 'تم حفظ الأصل بالأرشيف وفحص البصمة الرقمية (SHA-256)...',
            })

        if ingest_res.get('status') == 'DUPLICATE_REJECTED':
            with TASKS_LOCK:
                TASKS[task_id].update({
                    'status': 'DUPLICATE',
                    'step': 3,
                    'message': ingest_res.get('message', 'تم رفض الوثيقة لأنها ممسوحة مسبقاً بنفس البصمة.'),
                    'result': ingest_res,
                })
            return

        # Step 4: Ingest to Paperless
        with TASKS_LOCK:
            TASKS[task_id].update({
                'status': 'INGESTING',
                'step': 4,
                'message': 'تم ترحيل الوثيقة لمسار استهلاك Paperless وجاري بدء المعالجة...',
            })

        # Step 5: Wait for Paperless OCR & index
        with TASKS_LOCK:
            TASKS[task_id].update({
                'status': 'OCR_PROCESSING',
                'step': 5,
                'message': 'جاري استخراج النصوص بالـ OCR والتعرف العربي والفهرسة...',
            })

        doc_details = poll_paperless_consumption(filename, timeout_seconds=120)
        if not doc_details:
            raise TimeoutError('استغرق Paperless وقتاً أطول من المتوقع في استهلاك الوثيقة.')

        doc_id = doc_details.get('id')
        title = doc_details.get('title', filename)
        content = doc_details.get('content', '')
        ocr_preview = content[:250] + ('...' if len(content) > 250 else '')

        # AI Suggestions
        ai_suggestions = {}
        try:
            analysis = ArabicDocumentAnalyzer.analyze_document(doc_id=doc_id, content=content, title=title)
            ai_suggestions = {
                'title': analysis.title_suggestion.value,
                'official_document_number': analysis.official_doc_number.value,
                'sender': analysis.sender.value,
                'recipient': analysis.recipient.value,
                'department': analysis.department_suggestion.value,
                'confidence': analysis.title_suggestion.confidence,
            }
        except Exception as ai_err:
            logger.debug('AI suggestions non-critical error: %s', ai_err)

        paperless_url = f"{PAPERLESS_BASE_URL}/documents/{doc_id}/details"
        result_payload = {
            'document_id': doc_id,
            'title': title,
            'paperless_url': paperless_url,
            'sha256': ingest_res.get('sha256'),
            'section': section,
            'archived_copy': ingest_res.get('archived_copy'),
            'ocr_preview': ocr_preview,
            'ai_suggestions': ai_suggestions,
        }

        with TASKS_LOCK:
            TASKS[task_id].update({
                'status': 'SUCCESS',
                'step': 5,
                'message': 'تمت أرشفة الوثيقة بنجاح وفهرستها في Paperless!',
                'result': result_payload,
            })

    except Exception as exc:
        logger.error('Task %s failed: %s', task_id, exc, exc_info=True)
        error_msg = str(exc)
        # Friendly Arabic error explanations
        if 'feeder' in error_msg.lower() or 'paper' in error_msg.lower():
            friendly_err = 'تعذر المسح: يرجى التأكد من وضع الأوراق في مغذي المستندات (ADF) أو اختيار مسطح الزجاج.'
        elif 'device' in error_msg.lower() or 'not found' in error_msg.lower():
            friendly_err = 'تعذر العثور على الماسح الضوئي: يرجى التأكد من تشغيل الطابعة وتوصيل كابل USB أو الشبكة.'
        elif 'timed out' in error_msg.lower():
            friendly_err = 'انتهت مهلة الاتصال بالماسح الضوئي، يرجى المحاولة مجدداً.'
        else:
            friendly_err = f'حدث خطأ أثناء المعالجة: {error_msg}'

        with TASKS_LOCK:
            TASKS[task_id].update({
                'status': 'FAILED',
                'error': friendly_err,
                'message': friendly_err,
            })


class ScannerBridgeHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler for Local Scanner Bridge."""

    server_version = 'NAS-ScannerBridge/1.1.0'

    def log_message(self, format, *args):
        """Route HTTP access logs to the application logger safely."""
        logger.info("%s - - [%s] %s", self.address_string(), self.log_date_time_string(), format % args)

    def send_cors_and_security_headers(self):
        """Send local security and CORS headers."""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')

    def send_json(self, status_code: int, data: Any):
        """Send formatted JSON response."""
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_cors_and_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Handle CORS pre-flight."""
        self.send_response(204)
        self.send_cors_and_security_headers()
        self.end_headers()

    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # Web UI
        if path in ('', '/scan', '/index.html'):
            if not INDEX_HTML.exists():
                self.send_json(404, {'error': 'web/index.html not found'})
                return
            html_bytes = INDEX_HTML.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html_bytes)))
            self.send_cors_and_security_headers()
            self.end_headers()
            self.wfile.write(html_bytes)
            return

        # API: Status
        if path == '/api/status':
            paperless_online = check_paperless_online()
            naps2_path = scanner_ingest.find_naps2_executable()
            detected = get_cached_devices() if naps2_path else []

            self.send_json(200, {
                'status': 'HEALTHY',
                'paperless': {
                    'online': paperless_online,
                    'url': PAPERLESS_BASE_URL,
                },
                'scanner': {
                    'naps2_installed': bool(naps2_path),
                    'naps2_path': naps2_path,
                    'default_driver': 'wia',
                    'detected_devices': detected,
                },
                'version': '1.2.0'
            })
            return

        # API: Devices
        if path == '/api/devices':
            query = parse_qs(parsed.query)
            driver = query.get('driver', ['wia'])[0]
            if driver not in VALID_DRIVERS and driver != 'all':
                driver = 'wia'

            devices = []
            if driver == 'all':
                all_devs = scanner_ingest.list_scanning_devices()
                for d_list in all_devs.values():
                    devices.extend([d for d in d_list if not d.startswith('Error:')])
                devices = list(dict.fromkeys(devices))
            else:
                devs = scanner_ingest.list_scanning_devices(driver).get(driver, [])
                devices = [d for d in devs if not d.startswith('Error:')]

            self.send_json(200, {
                'devices': devices,
                'driver': driver,
                'drivers_available': list(VALID_DRIVERS),
                'sources': [
                    {'id': 'auto', 'name': 'تلقائي (حسب إعدادات الجهاز)'},
                    {'id': 'glass', 'name': 'مسطح الزجاج (Flatbed)'},
                    {'id': 'feeder', 'name': 'مغذي المستندات - وجه واحد (ADF Simplex)'},
                    {'id': 'duplex', 'name': 'مغذي المستندات - وجهين (ADF Duplex)'},
                ],
                'sections': list(scanner_ingest.VALID_SECTIONS),
                'dpis': list(VALID_DPIS),
                'bitdepths': [
                    {'id': 'color', 'name': 'ملون (Color)'},
                    {'id': 'gray', 'name': 'تدرج رمادي (Grayscale)'},
                    {'id': 'bw', 'name': 'أبيض وأسود (Monochrome)'},
                ]
            })
            return

        # API: Specific Task Status
        if path.startswith('/api/tasks/'):
            task_id = path[len('/api/tasks/'):]
            with TASKS_LOCK:
                task = TASKS.get(task_id)
            if not task:
                self.send_json(404, {'error': f'Task {task_id} not found'})
                return
            self.send_json(200, task)
            return

        # API: Recent Tasks
        if path == '/api/tasks':
            with TASKS_LOCK:
                tasks_list = sorted(TASKS.values(), key=lambda t: t.get('created_at', ''), reverse=True)
            self.send_json(200, tasks_list[:25])
            return

        # API: Staged Document Preview
        if path.startswith('/api/staging/'):
            raw_filename = path[len('/api/staging/'):]
            safe_name = sanitize_filename(raw_filename)
            target_path = STAGING_DIR / safe_name
            if not target_path.exists() or not target_path.is_file():
                self.send_json(404, {'error': 'Staged document not found'})
                return

            ext = target_path.suffix.lower()
            mime = 'application/pdf'
            if ext in ('.jpg', '.jpeg'):
                mime = 'image/jpeg'
            elif ext == '.png':
                mime = 'image/png'
            elif ext in ('.tif', '.tiff'):
                mime = 'image/tiff'

            file_bytes = target_path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(file_bytes)))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Disposition', f'inline; filename="{safe_name}"')
            self.send_cors_and_security_headers()
            self.end_headers()
            self.wfile.write(file_bytes)
            return

        self.send_json(404, {'error': 'Endpoint not found'})

    def do_DELETE(self):
        """Handle DELETE requests for discarding staged files."""
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        if path.startswith('/api/staging/'):
            raw_filename = path[len('/api/staging/'):]
            safe_name = sanitize_filename(raw_filename)
            target_path = STAGING_DIR / safe_name
            if target_path.exists() and target_path.is_file():
                try:
                    target_path.unlink()
                    self.send_json(200, {'status': 'DISCARDED', 'filename': safe_name})
                    return
                except Exception as exc:
                    self.send_json(500, {'error': f'Failed to discard staged file: {exc}'})
                    return
            self.send_json(404, {'error': 'Staged document not found'})
            return
        self.send_json(404, {'error': 'Endpoint not found'})

    def do_POST(self):
        """Handle POST requests."""
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        content_length = int(self.headers.get('Content-Length', 0))
        content_type = self.headers.get('Content-Type', '')

        # API: Scan Document (supports stage_only or full scan)
        if path in ('/api/scan', '/api/scan/stage'):
            if content_length == 0 or 'application/json' not in content_type:
                self.send_json(400, {'error': 'Expected application/json body'})
                return

            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json(400, {'error': 'Invalid JSON format'})
                return

            # Validation against allowlists
            section = data.get('section', 'شخصي')
            if section not in scanner_ingest.VALID_SECTIONS:
                self.send_json(400, {'error': f'Invalid section. Must be one of: {scanner_ingest.VALID_SECTIONS}'})
                return

            driver = data.get('driver', 'wia')
            if driver not in VALID_DRIVERS:
                self.send_json(400, {'error': f'Invalid driver. Must be one of: {VALID_DRIVERS}'})
                return

            source = data.get('source')
            if source and source not in VALID_SOURCES:
                self.send_json(400, {'error': f'Invalid source. Must be one of: {VALID_SOURCES}'})
                return

            bitdepth = data.get('bitdepth', 'color')
            if bitdepth not in VALID_BITDEPTHS:
                self.send_json(400, {'error': f'Invalid bitdepth. Must be one of: {VALID_BITDEPTHS}'})
                return

            dpi = int(data.get('dpi', 300))
            if dpi not in VALID_DPIS:
                self.send_json(400, {'error': f'Invalid dpi. Must be one of: {VALID_DPIS}'})
                return

            device = data.get('device')
            if device and re.search(r'[;&|<>`$]', str(device)):
                self.send_json(400, {'error': 'Device name contains illegal shell characters.'})
                return

            is_stage_only = (path == '/api/scan/stage') or bool(data.get('stage_only', False))
            task_type = 'scan_stage' if is_stage_only else 'scan'
            total_steps = 2 if is_stage_only else 5
            initial_msg = 'تم تسجيل طلب المسح المبدئي للمعاينة...' if is_stage_only else 'تم تسجيل طلب المسح، بانتظار بدء المعالجة...'

            task_id = f"{task_type}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{os.urandom(3).hex()}"
            task_entry = {
                'task_id': task_id,
                'type': task_type,
                'status': 'QUEUED',
                'step': 1,
                'total_steps': total_steps,
                'message': initial_msg,
                'section': section,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'result': None,
                'error': None,
            }
            with TASKS_LOCK:
                TASKS[task_id] = task_entry

            # Start worker thread
            threading.Thread(
                target=background_task_worker,
                args=(task_id, task_type, data),
                daemon=True
            ).start()

            self.send_json(202, {'status': 'QUEUED', 'task_id': task_id})
            return

        # API: Archive Staged Document
        if path in ('/api/scan/archive', '/api/archive'):
            if content_length == 0 or 'application/json' not in content_type:
                self.send_json(400, {'error': 'Expected application/json body'})
                return

            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json(400, {'error': 'Invalid JSON format'})
                return

            raw_filename = data.get('filename') or data.get('staging_file')
            if not raw_filename:
                self.send_json(400, {'error': 'Missing filename or staging_file to archive'})
                return

            safe_name = sanitize_filename(raw_filename)
            staging_file = STAGING_DIR / safe_name
            if not staging_file.exists():
                self.send_json(404, {'error': f'Staged file not found: {safe_name}'})
                return

            section = data.get('section', 'شخصي')
            if section not in scanner_ingest.VALID_SECTIONS:
                self.send_json(400, {'error': f'Invalid section. Must be one of: {scanner_ingest.VALID_SECTIONS}'})
                return

            task_id = f"archive_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{os.urandom(3).hex()}"
            task_entry = {
                'task_id': task_id,
                'type': 'archive',
                'status': 'QUEUED',
                'step': 3,
                'total_steps': 5,
                'message': 'تم تسجيل طلب الأرشفة، جاري المعالجة...',
                'section': section,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'result': None,
                'error': None,
            }
            with TASKS_LOCK:
                TASKS[task_id] = task_entry

            worker_params = {
                'filename': safe_name,
                'section': section,
                'allow_duplicate': bool(data.get('allow_duplicate', False)),
            }

            threading.Thread(
                target=background_task_worker,
                args=(task_id, 'archive', worker_params),
                daemon=True
            ).start()

            self.send_json(202, {'status': 'QUEUED', 'task_id': task_id})
            return

        # API: Import File to Staging Only (Stage A)
        if path == '/api/import/stage':
            if content_length == 0 or 'application/json' not in content_type:
                self.send_json(400, {'error': 'Expected application/json with base64 payload'})
                return

            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json(400, {'error': 'Invalid JSON format'})
                return

            raw_filename = data.get('filename', '')
            section = data.get('section', 'شخصي')
            file_data_b64 = data.get('file_data', '')

            if not raw_filename or file_data_b64 is None:
                self.send_json(400, {'error': 'Missing filename or file_data'})
                return

            if file_data_b64 == '':
                self.send_json(400, {'error': 'File is empty (0 bytes)'})
                return

            if section not in scanner_ingest.VALID_SECTIONS:
                self.send_json(400, {'error': f'Invalid section. Must be one of: {scanner_ingest.VALID_SECTIONS}'})
                return

            safe_name = sanitize_filename(raw_filename)
            ext = Path(safe_name).suffix.lower()
            if ext not in scanner_ingest.SUPPORTED_EXTENSIONS:
                self.send_json(400, {'error': f'Unsupported file format "{ext}". Must be one of: {list(scanner_ingest.SUPPORTED_EXTENSIONS.keys())}'})
                return

            try:
                file_bytes = base64.b64decode(file_data_b64)
            except Exception:
                self.send_json(400, {'error': 'Invalid base64 encoding'})
                return

            if len(file_bytes) == 0:
                self.send_json(400, {'error': 'File is empty (0 bytes)'})
                return

            # Check header
            valid_headers = scanner_ingest.SUPPORTED_EXTENSIONS[ext]
            if not any(file_bytes.startswith(hdr) for hdr in valid_headers):
                self.send_json(400, {'error': f'File format error: {ext} lacks valid signature header.'})
                return

            STAGING_DIR.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            staged_filename = f"{timestamp}_{safe_name}"
            staging_file = STAGING_DIR / staged_filename
            staging_file.write_bytes(file_bytes)

            pages_count = 1
            if ext == '.pdf':
                try:
                    pages_count = max(1, len(re.findall(rb'/Type\s*/Page\b', file_bytes)))
                except Exception:
                    pass

            sha256_hash = scanner_ingest.compute_file_hash(staging_file)
            task_id = f"stage_import_{timestamp}_{os.urandom(3).hex()}"
            result_payload = {
                'stage_id': task_id,
                'staging_path': str(staging_file),
                'filename': staged_filename,
                'size_bytes': len(file_bytes),
                'sha256': sha256_hash,
                'pages_count': pages_count,
                'section': section,
                'preview_url': f"/api/staging/{staged_filename}",
            }

            task_entry = {
                'task_id': task_id,
                'type': 'import_stage',
                'status': 'STAGED_READY',
                'step': 2,
                'total_steps': 2,
                'message': 'تم استلام الملف وجاهز للمعاينة والمراجعة قبل الأرشفة.',
                'section': section,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'result': result_payload,
                'error': None,
            }
            with TASKS_LOCK:
                TASKS[task_id] = task_entry

            self.send_json(202, {'status': 'STAGED_READY', 'task_id': task_id, 'result': result_payload})
            return

        # API: Import File (Legacy/Direct full import)
        if path == '/api/import':
            if content_length == 0 or 'application/json' not in content_type:
                self.send_json(400, {'error': 'Expected application/json with base64 payload'})
                return

            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json(400, {'error': 'Invalid JSON format'})
                return

            raw_filename = data.get('filename', '')
            section = data.get('section', 'شخصي')
            file_data_b64 = data.get('file_data', '')

            if not raw_filename or file_data_b64 is None:
                self.send_json(400, {'error': 'Missing filename or file_data'})
                return

            if file_data_b64 == '':
                self.send_json(400, {'error': 'File is empty (0 bytes)'})
                return

            if section not in scanner_ingest.VALID_SECTIONS:
                self.send_json(400, {'error': f'Invalid section. Must be one of: {scanner_ingest.VALID_SECTIONS}'})
                return

            safe_name = sanitize_filename(raw_filename)
            ext = Path(safe_name).suffix.lower()
            if ext not in scanner_ingest.SUPPORTED_EXTENSIONS:
                self.send_json(400, {'error': f'Unsupported file format "{ext}". Must be one of: {list(scanner_ingest.SUPPORTED_EXTENSIONS.keys())}'})
                return

            try:
                file_bytes = base64.b64decode(file_data_b64)
            except Exception:
                self.send_json(400, {'error': 'Invalid base64 encoding'})
                return

            if len(file_bytes) == 0:
                self.send_json(400, {'error': 'File is empty (0 bytes)'})
                return

            # Check header
            valid_headers = scanner_ingest.SUPPORTED_EXTENSIONS[ext]
            if not any(file_bytes.startswith(hdr) for hdr in valid_headers):
                self.send_json(400, {'error': f'File format error: {ext} lacks valid signature header.'})
                return

            STAGING_DIR.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
            staging_file = STAGING_DIR / f"{timestamp}_{safe_name}"
            staging_file.write_bytes(file_bytes)

            task_id = f"import_{timestamp}_{os.urandom(3).hex()}"
            task_entry = {
                'task_id': task_id,
                'type': 'import',
                'status': 'QUEUED',
                'step': 1,
                'total_steps': 5,
                'message': 'تم استلام الملف، بانتظار المعالجة والأرشفة...',
                'section': section,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'result': None,
                'error': None,
            }
            with TASKS_LOCK:
                TASKS[task_id] = task_entry

            worker_params = {
                'section': section,
                'staging_file': str(staging_file),
                'allow_duplicate': bool(data.get('allow_duplicate', False)),
            }

            threading.Thread(
                target=background_task_worker,
                args=(task_id, 'import', worker_params),
                daemon=True
            ).start()

            self.send_json(202, {'status': 'QUEUED', 'task_id': task_id})
            return

        self.send_json(404, {'error': 'Endpoint not found'})


def run_server(host: str = HOST, port: int = PORT):
    """Start the Local Scanner Bridge server."""
    # Strict localhost check
    if host not in ('127.0.0.1', 'localhost'):
        logger.error('SECURITY ERROR: Bridge must bind exclusively to 127.0.0.1. Refusing to bind to %s', host)
        sys.exit(1)

    server_address = (host, port)
    httpd = ThreadingHTTPServer(server_address, ScannerBridgeHandler)
    logger.info('========================================================')
    logger.info(' NAS Archive — Local Scanner Bridge v1.1.0')
    logger.info(' Listening on http://%s:%d', host, port)
    logger.info(' UI Interface: http://%s:%d/', host, port)
    logger.info(' Bound exclusively to local loopback (127.0.0.1)')
    logger.info('========================================================')

    # Discover scanning devices in background so server is instantly ready
    threading.Thread(target=refresh_devices_cache, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down Local Scanner Bridge gracefully...')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    run_server()
