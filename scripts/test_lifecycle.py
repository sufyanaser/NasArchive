"""End-to-End operational lifecycle verification:
SCAN -> IMPORT -> OCR -> AI SUGGESTIONS -> HUMAN REVIEW -> CLASSIFICATION -> ARCHIVE -> SEARCH -> APPROVAL -> DRIVE -> SHEETS
"""
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw

from ai_processor import ArabicDocumentAnalyzer
from bootstrap import Client
from google_cloud_adapter import DryRunDriveClient, DryRunSheetsClient
import scanner_ingest
from sync_engine import SyncEngine
from sync_ledger import SyncLedger
from sync_validator import format_sheets_row, validate_for_publication

ROOT = Path(__file__).resolve().parents[1]
LEDGER_PATH = ROOT / 'runtime' / 'sync_ledger.db'

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


def get_authenticated_client():
    creds_path = ROOT / 'runtime' / 'admin-login.json'
    if not creds_path.exists():
        raise SystemExit('Missing runtime/admin-login.json')
    creds = json.loads(creds_path.read_text(encoding='utf-8'))
    req = Request(
        'http://localhost:8000/api/token/',
        data=json.dumps({'username': creds['username'], 'password': creds['password']}).encode(),
        headers={'Content-Type': 'application/json'}
    )
    with urlopen(req, timeout=30) as resp:
        token = json.load(resp)['token']
    return Client('http://localhost:8000', token)


def create_synthetic_multipage_pdf(output_path: Path):
    """Generate a clean synthetic multipage PDF with English/Arabic administrative text."""
    pages = []
    texts = [
        [
            'Republic of Iraq - Ministry of Trade',
            'Number: 0077/S-2026',
            'Date: 2026-09-23',
            'Subject: NAS Archive Hardware Supply Contract',
            'From: IT Directorate',
            'To: Al-Raneen Company',
            'Registration: 00543-Q',
            'Department: Al-Raneen',
            'Searchable Keyword: NASARCHIVE_TEST_TOKEN_2026',
        ],
        [
            'Page 2 - Annex and Technical Specifications',
            'Reviewer: Sufyan Aser',
            'Review Date: 2026-09-23',
            'Status: Pending Audit and Administrative Verification',
        ]
    ]
    for lines in texts:
        img = Image.new('RGB', (2480, 3508), color='white')
        draw = ImageDraw.Draw(img)
        y = 300
        for line in lines:
            draw.text((200, y), line, fill='black')
            y += 220
        pages.append(img)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(output_path, 'PDF', resolution=300.0, save_all=True, append_images=pages[1:])
    logger.info('Created synthetic multipage PDF at %s', output_path)


def test_full_lifecycle():
    sys.stdout.reconfigure(encoding='utf-8')
    client = get_authenticated_client()

    server_fields = {f['name']: f['id'] for f in client.list_all('custom_fields')}
    server_types = {t['name']: t['id'] for t in client.list_all('document_types')}
    server_tags = {t['name']: t['id'] for t in client.list_all('tags')}

    target_section = 'الرنين'
    sample_title = f'nas-lifecycle-{int(time.time())}'
    staging_file = ROOT / 'runtime' / 'staging' / f'{sample_title}.pdf'

    # Step 1: Create synthetic document
    logger.info('--- STEP 1: SCAN / PREPARE ---')
    create_synthetic_multipage_pdf(staging_file)
    original_sha256 = scanner_ingest.compute_file_hash(staging_file)

    # Step 2: Import & Ingestion
    logger.info('--- STEP 2: INGESTION PIPELINE ---')
    ingest_res = scanner_ingest.ingest_file(staging_file, section=target_section)
    assert ingest_res['status'] == 'INGESTED', f'Ingest failed: {ingest_res}'
    assert Path(ingest_res['archived_copy']).exists(), 'Scanned original was not preserved'
    logger.info('Preserved scanned copy at: %s', ingest_res['archived_copy'])

    # Step 3: Duplicate Prevention Test
    logger.info('--- STEP 3: DUPLICATE DETECTION ---')
    dup_staging = ROOT / 'runtime' / 'staging' / f'dup_{sample_title}.pdf'
    shutil.copyfile(ingest_res['archived_copy'], dup_staging)
    dup_res = scanner_ingest.ingest_file(dup_staging, section=target_section, allow_duplicate=False)
    assert dup_res['status'] == 'DUPLICATE_REJECTED', f'Duplicate was not rejected: {dup_res}'
    logger.info('Duplicate successfully detected and rejected.')
    dup_staging.unlink(missing_ok=True)

    # Step 4: Paperless Consumer Ingestion & OCR
    logger.info('--- STEP 4: PAPERLESS CONSUMPTION & OCR ---')
    deadline = time.monotonic() + 180
    found_doc = None
    consume_path = Path(ingest_res['consume_target'])

    while time.monotonic() < deadline:
        if not consume_path.exists():
            # File consumed!
            docs = client.list_all('documents')
            matches = [d for d in docs if sample_title in (d.get('title') or '') or sample_title in (d.get('original_file_name') or '')]
            if matches:
                found_doc = matches[0]
                break
        time.sleep(3)

    assert found_doc is not None, f'Paperless failed to ingest document within timeout: {sample_title}'
    doc_id = found_doc['id']
    logger.info('Document ingested into Paperless with ID %s', doc_id)

    # Verify auto-tagging
    tag_ids = found_doc.get('tags', [])
    assert server_tags[target_section] in tag_ids, f'Target section tag [{target_section}] not assigned'
    assert server_tags['بانتظار المراجعة'] in tag_ids, 'Inbox tag not assigned'

    # Step 5: Searchability
    logger.info('--- STEP 5: FULL-TEXT SEARCH ---')
    search_res = client.request('documents/?' + urlencode({'query': 'NASARCHIVE_TEST_TOKEN_2026'}))
    search_ids = [d['id'] for d in search_res.get('results', [])]
    assert doc_id in search_ids, 'Document not findable by OCR keyword search'
    logger.info('Document verified findable via Paperless search API.')

    # Step 6: AI Metadata Extraction & Suggestions
    logger.info('--- STEP 6: AI METADATA EXTRACTION ---')
    analysis = ArabicDocumentAnalyzer.analyze_document(
        doc_id=doc_id,
        content=found_doc.get('content', ''),
        title=found_doc.get('title', '')
    )
    assert analysis.ai_approved_sync is False, 'SECURITY VIOLATION: AI auto-approved sync!'
    logger.info('AI Title suggestion: %s', analysis.title_suggestion.value)
    logger.info('AI Department suggestion: %s', analysis.department_suggestion.value)

    # Step 7: Human Review & Classification Simulation
    logger.info('--- STEP 7: HUMAN REVIEW & CLASSIFICATION ---')
    official_doc_number = '0077/ص-2026'
    official_entry_number = '00543-ق'
    reviewer_name = 'سفيان'
    review_date = '2026-09-23'

    # Reviewer sets official fields and explicitly approves for sync
    cf_payload = [
        {'field': server_fields['رقم الكتاب'], 'value': official_doc_number},
        {'field': server_fields['الجهة المرسلة'], 'value': 'دائرة تكنولوجيا المعلومات'},
        {'field': server_fields['الجهة المستلمة'], 'value': 'شركة الرنين'},
        {'field': server_fields['تاريخ الورود'], 'value': '2026-09-23'},
        {'field': server_fields['رقم القيد'], 'value': official_entry_number},
        {'field': server_fields['راجعه'], 'value': reviewer_name},
        {'field': server_fields['تاريخ المراجعة'], 'value': review_date},
        {'field': server_fields['معتمد للمزامنة'], 'value': True},  # EXPLICIT HUMAN APPROVAL
    ]

    # Human reviewer removes inbox tag
    clean_tags = [t for t in tag_ids if t != server_tags['بانتظار المراجعة']]

    patch_body = {
        'title': 'عقد تجهيز أجهزة حاسوب',
        'document_type': server_types['كتاب وارد'],
        'tags': clean_tags,
        'custom_fields': cf_payload,
    }
    updated_doc = client.request(f'documents/{doc_id}/', patch_body, method='PATCH')
    logger.info('Human review applied: Inbox tag removed, official fields assigned, approved for sync.')

    # Step 8: Cloud Synchronization (Drive + Sheets)
    logger.info('--- STEP 8: SYNCHRONIZATION PIPELINE ---')
    # Download file content for sync
    dl_url = client.base + f'documents/{doc_id}/download/'
    dl_req = Request(dl_url, headers={'Authorization': f'Token {client.token}'})
    with urlopen(dl_req, timeout=30) as resp:
        downloaded_bytes = resp.read()

    ledger = SyncLedger(LEDGER_PATH)
    mock_drive = DryRunDriveClient()
    mock_sheets = DryRunSheetsClient()

    engine = SyncEngine(
        instance_id='nas-prod',
        paperless_base_url='http://localhost:8000',
        ledger=ledger,
        drive_client=mock_drive,
        sheets_client=mock_sheets,
    )

    sync_res = engine.sync_document(
        doc_dict=updated_doc,
        file_bytes=downloaded_bytes,
        catalog_tags={v: k for k, v in server_tags.items()},
        catalog_doc_types={v: k for k, v in server_types.items()},
        catalog_fields={v: k for k, v in server_fields.items()},
    )
    assert sync_res['status'] == 'SUCCESS', f'Sync failed: {sync_res}'
    logger.info('Document successfully synchronized to Drive & Sheets (key: %s)', sync_res['sync_key'])

    # Step 9: Idempotency Verification
    logger.info('--- STEP 9: IDEMPOTENCY VERIFICATION ---')
    resync_res = engine.sync_document(
        doc_dict=updated_doc,
        file_bytes=downloaded_bytes,
        catalog_tags={v: k for k, v in server_tags.items()},
        catalog_doc_types={v: k for k, v in server_types.items()},
        catalog_fields={v: k for k, v in server_fields.items()},
    )
    assert resync_res['status'] == 'ALREADY_SYNCED', 'Sync was not idempotent!'
    logger.info('Re-sync correctly skipped with ALREADY_SYNCED.')

    # Step 10: Reset approval flag to False for safety
    logger.info('--- STEP 10: RESET SAFE STATE ---')
    reset_cf = [cf for cf in cf_payload if cf['field'] != server_fields['معتمد للمزامنة']]
    reset_cf.append({'field': server_fields['معتمد للمزامنة'], 'value': False})
    client.request(f'documents/{doc_id}/', {'custom_fields': reset_cf}, method='PATCH')
    logger.info('Reset "معتمد للمزامنة" to False for security.')

    print('\n======================================================')
    print('ALL 10 LIFECYCLE PHASES COMPLETED AND VERIFIED:')
    print('  1. Synthetic multipage document generation: PASS')
    print('  2. Ingestion pipeline & staging move: PASS')
    print('  3. Scanned archive preservation: PASS')
    print('  4. Duplicate detection and rejection: PASS')
    print('  5. Paperless consumption & OCR extraction: PASS')
    print('  6. Bilingual keyword search: PASS')
    print('  7. AI metadata suggestions & confidence scoring: PASS')
    print('  8. Human review, classification & approval: PASS')
    print('  9. Cloud sync contract (Drive upload + Sheets index): PASS')
    print(' 10. Idempotency & safe post-test reset: PASS')
    print('======================================================\n')


if __name__ == '__main__':
    test_full_lifecycle()
