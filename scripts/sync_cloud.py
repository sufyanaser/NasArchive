"""CLI utility to orchestrate synchronization from Paperless-ngx to Google Drive and Google Sheets."""
import argparse
import json
import logging
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from bootstrap import Client
from google_cloud_adapter import (
    get_google_credentials,
    GoogleCloudConfigError,
    ProductionGoogleDriveClient,
    ProductionGoogleSheetsClient,
)
from sync_engine import SyncEngine, DriveClientInterface, SheetsClientInterface
from sync_ledger import SyncLedger
from sync_validator import format_sheets_row, validate_for_publication, ValidationError

ROOT = Path(__file__).resolve().parents[1]
LEDGER_PATH = ROOT / 'runtime' / 'sync_ledger.db'

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


class DryRunDriveClient(DriveClientInterface):
    def find_file_by_sync_key(self, sync_key: str):
        return None

    def upload_file(self, sync_key: str, filename: str, content: bytes, folder_path: str):
        return {
            'file_id': f'dry_run_drive_id_{sync_key}',
            'web_view_link': f'https://drive.google.com/file/d/dry_run_drive_id_{sync_key}/view',
            'filename': filename,
        }


class DryRunSheetsClient(SheetsClientInterface):
    def upsert_row(self, sync_key: str, row_values: list):
        return f'DryRunSheet!A_{sync_key}'


def get_authenticated_paperless_client() -> Client:
    creds_path = ROOT / 'runtime' / 'admin-login.json'
    if not creds_path.exists():
        raise SystemExit('runtime/admin-login.json is missing.')
    creds = json.loads(creds_path.read_text(encoding='utf-8'))
    req = Request(
        'http://localhost:8000/api/token/',
        data=json.dumps({'username': creds['username'], 'password': creds['password']}).encode(),
        headers={'Content-Type': 'application/json'}
    )
    with urlopen(req, timeout=30) as resp:
        token = json.load(resp)['token']
    return Client('http://localhost:8000', token)


def sync_cloud_documents(
    doc_id: Optional[int] = None,
    dry_run: bool = True,
    instance_id: str = 'nas-prod',
) -> list:
    sys.stdout.reconfigure(encoding='utf-8')
    client = get_authenticated_paperless_client()

    catalog_tags = {item['id']: item['name'] for item in client.list_all('tags')}
    catalog_doc_types = {item['id']: item['name'] for item in client.list_all('document_types')}
    catalog_fields = {item['id']: item['name'] for item in client.list_all('custom_fields')}

    ledger = SyncLedger(LEDGER_PATH)

    if dry_run:
        logger.info('Running in DRY-RUN mode. No external network calls to Google will be made.')
        drive_client = DryRunDriveClient()
        sheets_client = DryRunSheetsClient()
    else:
        try:
            creds = get_google_credentials()
            drive_client = ProductionGoogleDriveClient(creds)
            sheets_client = ProductionGoogleSheetsClient(creds)
        except GoogleCloudConfigError as exc:
            logger.error('Google Cloud configuration error: %s', exc)
            raise SystemExit(1)

    engine = SyncEngine(
        instance_id=instance_id,
        paperless_base_url='http://localhost:8000',
        ledger=ledger,
        drive_client=drive_client,
        sheets_client=sheets_client,
    )

    if doc_id:
        docs = [client.request(f'documents/{doc_id}/')]
    else:
        # Fetch all candidate documents
        docs = client.list_all('documents')

    results = []
    for doc in docs:
        doc_key = f'{instance_id}:{doc["id"]}'
        # Check if candidate has approval flag before downloading PDF
        cfs = doc.get('custom_fields', [])
        approved_val = False
        for cf in cfs:
            if catalog_fields.get(cf.get('field')) == 'معتمد للمزامنة' and cf.get('value') is True:
                approved_val = True
                break

        if not approved_val and not doc_id:
            # Skip unapproved documents silently during full scan
            continue

        # Download document file bytes
        download_url = client.base + f'documents/{doc["id"]}/download/'
        req = Request(download_url, headers={'Authorization': f'Token {client.token}'})
        try:
            with urlopen(req, timeout=30) as resp:
                file_bytes = resp.read()
        except HTTPError as err:
            logger.error('Failed to download document %s: %s', doc_key, err)
            continue

        try:
            res = engine.sync_document(
                doc_dict=doc,
                file_bytes=file_bytes,
                catalog_tags=catalog_tags,
                catalog_doc_types=catalog_doc_types,
                catalog_fields=catalog_fields,
            )
            logger.info('Sync result for %s: %s', doc_key, res['status'])
            results.append(res)
        except ValidationError as err:
            logger.warning('Validation rejected document %s: %s', doc_key, err)
            results.append({'sync_key': doc_key, 'status': 'VALIDATION_REJECTED', 'error': str(err)})
        except Exception as exc:
            logger.error('Sync failed for %s: %s', doc_key, exc)
            results.append({'sync_key': doc_key, 'status': 'FAILED', 'error': str(exc)})

    # Write summary to runtime
    report_file = ROOT / 'runtime' / 'sync_results.json'
    report_file.parent.mkdir(parents=True, exist_ok=True)
    report_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    logger.info('Wrote sync summary to %s', report_file)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doc-id', type=int, help='Sync a specific document ID')
    parser.add_argument('--live', action='store_true', help='Execute live sync to Google Cloud (requires credentials)')
    parser.add_argument('--instance-id', default='nas-prod', help='Instance identifier prefix')
    args = parser.parse_args()

    results = sync_cloud_documents(
        doc_id=args.doc_id,
        dry_run=not args.live,
        instance_id=args.instance_id,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
