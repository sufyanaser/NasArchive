"""One-way idempotent sync engine: Paperless -> Google Drive -> Google Sheets."""
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from typing import Any, Callable, Dict, List, Optional

from sync_ledger import SyncLedger
from sync_validator import (
    format_sheets_row,
    validate_for_publication,
    ValidatedDocument,
    ValidationError,
)

logger = logging.getLogger(__name__)


class DriveClientInterface:
    """Interface for Google Drive operations."""
    def find_file_by_sync_key(self, sync_key: str) -> Optional[Dict[str, str]]:
        """Search existing files by custom appProperties key before uploading."""
        raise NotImplementedError

    def upload_file(self, sync_key: str, filename: str, content: bytes,
                    folder_path: str) -> Dict[str, str]:
        """Upload file and return {'file_id': ..., 'web_view_link': ...}."""
        raise NotImplementedError


class SheetsClientInterface:
    """Interface for Google Sheets operations."""
    def upsert_row(self, sync_key: str, row_values: List[Any]) -> str:
        """Update existing row or append new row identified by sync_key. Return row identifier."""
        raise NotImplementedError


class SyncEngine:
    def __init__(
        self,
        instance_id: str,
        paperless_base_url: str,
        ledger: SyncLedger,
        drive_client: DriveClientInterface,
        sheets_client: SheetsClientInterface,
    ):
        self.instance_id = instance_id
        self.paperless_base_url = paperless_base_url
        self.ledger = ledger
        self.drive_client = drive_client
        self.sheets_client = sheets_client

    def sync_document(
        self,
        doc_dict: Dict[str, Any],
        file_bytes: bytes,
        catalog_tags: Dict[int, str],
        catalog_doc_types: Dict[int, str],
        catalog_fields: Dict[int, str],
    ) -> Dict[str, Any]:
        """Run the full gated, idempotent synchronization cycle for a document."""
        # 1. Validation & Preconditions
        vdoc = validate_for_publication(
            instance_id=self.instance_id,
            doc=doc_dict,
            file_bytes=file_bytes,
            catalog_tags=catalog_tags,
            catalog_doc_types=catalog_doc_types,
            catalog_fields=catalog_fields,
        )

        sync_key = vdoc.sync_key

        # 2. Check if already synced with same approved hash (Idempotency)
        if self.ledger.is_already_synced(sync_key, vdoc.approved_hash):
            return {
                'status': 'ALREADY_SYNCED',
                'sync_key': sync_key,
                'message': 'Document already synchronized with matching approved hash',
            }

        # 3. Check for post-approval content or metadata modification
        existing_entry = self.ledger.get_entry(sync_key)
        if existing_entry and existing_entry.get('status') == 'SYNCED' and existing_entry.get('approved_hash') != vdoc.approved_hash:
            raise ValidationError(
                f'Document {sync_key} was modified after previous sync! Requires fresh review and re-approval.'
            )

        # 4. Lock / Register attempt in persistent ledger
        self.ledger.register_attempt(
            sync_key=sync_key,
            instance_id=self.instance_id,
            doc_id=vdoc.document_id,
            approved_hash=vdoc.approved_hash,
            section=vdoc.section,
        )

        # 5. Drive Upload (with resume check)
        drive_file_id = None
        drive_file_url = None

        if self.ledger.can_resume_sheets_only(sync_key, vdoc.approved_hash):
            # Sheets failed previously, but Drive upload succeeded! Reuse existing Drive file
            drive_file_id = existing_entry['drive_file_id']
            drive_file_url = existing_entry['drive_file_url']
            logger.info('Resuming sync for %s: Drive file already uploaded (%s)', sync_key, drive_file_id)
        else:
            try:
                # Pre-upload check: search Drive by sync_key in appProperties before uploading
                # to prevent duplicate creation if previous upload request timed out
                existing_drive = self.drive_client.find_file_by_sync_key(sync_key)
                if existing_drive:
                    drive_file_id = existing_drive['file_id']
                    drive_file_url = existing_drive['web_view_link']
                else:
                    year = vdoc.created_date[:4]
                    folder_path = f'{vdoc.section}/{year}'
                    safe_filename = f'{vdoc.doc_number}_{vdoc.title}.pdf'.replace('/', '-').replace('\\', '-')
                    upload_res = self.drive_client.upload_file(
                        sync_key=sync_key,
                        filename=safe_filename,
                        content=file_bytes,
                        folder_path=folder_path,
                    )
                    drive_file_id = upload_res['file_id']
                    drive_file_url = upload_res['web_view_link']

                # CRITICAL: Save drive_file_id to ledger BEFORE attempting Sheets!
                self.ledger.record_drive_success(sync_key, drive_file_id, drive_file_url)

            except Exception as exc:
                self.ledger.record_failure(sync_key, f'Drive upload failed: {exc}')
                raise

        # 6. Sheets Update
        try:
            sync_timestamp = datetime.now(timezone.utc).isoformat()
            row_values = format_sheets_row(
                vdoc=vdoc,
                drive_file_url=drive_file_url,
                paperless_base_url=self.paperless_base_url,
                sync_timestamp=sync_timestamp,
            )
            row_key = self.sheets_client.upsert_row(sync_key, row_values)

            # Record final success
            self.ledger.record_sheet_success(sync_key, row_key)
            return {
                'status': 'SUCCESS',
                'sync_key': sync_key,
                'drive_file_id': drive_file_id,
                'drive_file_url': drive_file_url,
                'sheet_row_key': row_key,
            }
        except Exception as exc:
            self.ledger.record_failure(sync_key, f'Sheets update failed: {exc}')
            raise
