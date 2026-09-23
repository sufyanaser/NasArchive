"""Production-ready Google Drive and Sheets clients with OAuth/Service Account auth, retry backoff, and idempotent indexing."""
import io
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional

try:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaIoBaseUpload
    GOOGLE_LIBS_AVAILABLE = True
except ImportError:
    GOOGLE_LIBS_AVAILABLE = False

from sync_engine import DriveClientInterface, SheetsClientInterface

logger = logging.getLogger(__name__)


class DryRunDriveClient(DriveClientInterface):
    """Dry-run Drive client for testing and validation without network calls."""
    def __init__(self):
        self.files_by_sync_key = {}

    def find_file_by_sync_key(self, sync_key: str):
        return self.files_by_sync_key.get(sync_key)

    def upload_file(self, sync_key: str, filename: str, content: bytes, folder_path: str):
        record = {
            'file_id': f'dry_run_drive_id_{sync_key}',
            'web_view_link': f'https://drive.google.com/file/d/dry_run_drive_id_{sync_key}/view',
            'filename': filename,
        }
        self.files_by_sync_key[sync_key] = record
        return record


class DryRunSheetsClient(SheetsClientInterface):
    """Dry-run Sheets client for testing and validation without network calls."""
    def __init__(self):
        self.rows = {}

    def upsert_row(self, sync_key: str, row_values: list):
        self.rows[sync_key] = row_values
        return f'DryRunSheet!A_{sync_key}'

SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
]


class GoogleCloudConfigError(RuntimeError):
    """Raised when Google credentials or resource IDs are missing or invalid."""
    pass


def get_google_credentials(credentials_path: Optional[Path] = None) -> Any:
    """Load Service Account or OAuth credentials from file or environment variable."""
    if not GOOGLE_LIBS_AVAILABLE:
        raise GoogleCloudConfigError('Google API client libraries are not installed.')

    env_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    target_path = Path(env_path) if env_path else (credentials_path or Path('runtime/google_credentials.json'))

    if not target_path.exists():
        raise GoogleCloudConfigError(
            f'Google credentials file not found at: {target_path}. '
            'Please provide a Service Account JSON or OAuth token at runtime/google_credentials.json '
            'or set the GOOGLE_APPLICATION_CREDENTIALS environment variable.'
        )

    try:
        # Try Service Account first
        return service_account.Credentials.from_service_account_file(
            str(target_path), scopes=SCOPES
        )
    except Exception:
        # Fall back to user authorized credentials
        try:
            return Credentials.from_authorized_user_file(str(target_path), scopes=SCOPES)
        except Exception as exc:
            raise GoogleCloudConfigError(f'Failed to parse Google credentials from {target_path}: {exc}')


class ProductionGoogleDriveClient(DriveClientInterface):
    """Production Google Drive client supporting search by sync_key, nested folders, and exponential backoff."""
    def __init__(self, credentials: Any, root_folder_id: Optional[str] = None):
        self.service = build('drive', 'v3', credentials=credentials, cache_discovery=False)
        self.root_folder_id = root_folder_id or os.environ.get('GOOGLE_DRIVE_FOLDER_ID')

    def _execute_with_retry(self, request_builder: Any, max_retries: int = 5) -> Any:
        for attempt in range(max_retries):
            try:
                return request_builder.execute()
            except HttpError as err:
                status = err.resp.status
                if status in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                    sleep_time = (2 ** attempt) + 0.5
                    logger.warning('Google Drive HTTP %s; retrying in %.1fs...', status, sleep_time)
                    time.sleep(sleep_time)
                else:
                    raise

    def find_file_by_sync_key(self, sync_key: str) -> Optional[Dict[str, str]]:
        query = f"appProperties has {{ key='sync_key' and value='{sync_key}' }} and trashed = false"
        req = self.service.files().list(
            q=query,
            spaces='drive',
            fields='files(id, name, webViewLink, appProperties)',
            pageSize=1
        )
        res = self._execute_with_retry(req)
        files = res.get('files', [])
        if files:
            f = files[0]
            return {
                'file_id': f['id'],
                'web_view_link': f.get('webViewLink') or f"https://drive.google.com/file/d/{f['id']}/view",
                'filename': f.get('name'),
            }
        return None

    def _get_or_create_folder(self, folder_name: str, parent_id: Optional[str]) -> str:
        q_parts = [
            f"name = '{folder_name}'",
            "mimeType = 'application/vnd.google-apps.folder'",
            "trashed = false"
        ]
        if parent_id:
            q_parts.append(f"'{parent_id}' in parents")
        query = ' and '.join(q_parts)

        req = self.service.files().list(q=query, spaces='drive', fields='files(id, name)', pageSize=1)
        res = self._execute_with_retry(req)
        files = res.get('files', [])
        if files:
            return files[0]['id']

        # Create folder
        meta = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
        }
        if parent_id:
            meta['parents'] = [parent_id]
        create_req = self.service.files().create(body=meta, fields='id')
        created = self._execute_with_retry(create_req)
        return created['id']

    def _resolve_folder_path(self, folder_path: str) -> Optional[str]:
        current_parent = self.root_folder_id
        for part in folder_path.strip('/').split('/'):
            if part:
                current_parent = self._get_or_create_folder(part, current_parent)
        return current_parent

    def upload_file(self, sync_key: str, filename: str, content: bytes, folder_path: str) -> Dict[str, str]:
        folder_id = self._resolve_folder_path(folder_path)
        file_metadata = {
            'name': filename,
            'appProperties': {'sync_key': sync_key},
        }
        if folder_id:
            file_metadata['parents'] = [folder_id]

        media = MediaIoBaseUpload(io.BytesIO(content), mimetype='application/pdf', resumable=True)
        req = self.service.files().create(body=file_metadata, media_body=media, fields='id, webViewLink')
        res = self._execute_with_retry(req)

        return {
            'file_id': res['id'],
            'web_view_link': res.get('webViewLink') or f"https://drive.google.com/file/d/{res['id']}/view",
            'filename': filename,
        }


class ProductionGoogleSheetsClient(SheetsClientInterface):
    """Production Google Sheets client supporting row upsert by sync_key (column A)."""
    def __init__(self, credentials: Any, spreadsheet_id: Optional[str] = None, sheet_name: str = 'Index'):
        self.service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
        self.spreadsheet_id = spreadsheet_id or os.environ.get('GOOGLE_SHEETS_SPREADSHEET_ID')
        self.sheet_name = sheet_name

    def _execute_with_retry(self, request_builder: Any, max_retries: int = 5) -> Any:
        for attempt in range(max_retries):
            try:
                return request_builder.execute()
            except HttpError as err:
                status = err.resp.status
                if status in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                    sleep_time = (2 ** attempt) + 0.5
                    logger.warning('Google Sheets HTTP %s; retrying in %.1fs...', status, sleep_time)
                    time.sleep(sleep_time)
                else:
                    raise

    def upsert_row(self, sync_key: str, row_values: List[Any]) -> str:
        if not self.spreadsheet_id:
            raise GoogleCloudConfigError('GOOGLE_SHEETS_SPREADSHEET_ID is not configured.')

        # Step 1: Read Column A to find if sync_key exists
        range_col_a = f'{self.sheet_name}!A:A'
        req_get = self.service.spreadsheets().values().get(
            spreadsheetId=self.spreadsheet_id, range=range_col_a
        )
        res_get = self._execute_with_retry(req_get)
        rows = res_get.get('values', [])

        target_row_index = None
        for idx, row in enumerate(rows, start=1):
            if row and row[0] == sync_key:
                target_row_index = idx
                break

        body = {'values': [row_values]}

        if target_row_index:
            # Update existing row
            update_range = f'{self.sheet_name}!A{target_row_index}:P{target_row_index}'
            req_update = self.service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range=update_range,
                valueInputOption='USER_ENTERED',
                body=body
            )
            self._execute_with_retry(req_update)
            return update_range
        else:
            # Append new row
            append_range = f'{self.sheet_name}!A:P'
            req_append = self.service.spreadsheets().values().append(
                spreadsheetId=self.spreadsheet_id,
                range=append_range,
                valueInputOption='USER_ENTERED',
                insertDataOption='INSERT_ROWS',
                body=body
            )
            res_append = self._execute_with_retry(req_append)
            updated_range = res_append.get('updates', {}).get('updatedRange', append_range)
            return updated_range
