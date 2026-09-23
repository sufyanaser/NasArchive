"""Validation and hashing rules for Paperless-to-Google sync pipeline."""
from dataclasses import dataclass
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

SECTIONS = ('شخصي', 'الرنين', 'تناسق', 'NAS FM')
INBOX_TAG = 'بانتظار المراجعة'
DOCUMENT_TYPES = ('كتاب وارد', 'كتاب صادر', 'كتاب داخلي')

REQUIRED_FIELDS = (
    'رقم الكتاب',
    'الجهة المرسلة',
    'الجهة المستلمة',
    'راجعه',
    'تاريخ المراجعة',
)


class ValidationError(ValueError):
    """Raised when a document fails publication preconditions."""
    pass


@dataclass
class ValidatedDocument:
    instance_id: str
    document_id: int
    sync_key: str
    section: str
    doc_type: str
    title: str
    created_date: str
    doc_number: str
    sender: str
    recipient: str
    incoming_date: Optional[str]
    entry_number: Optional[str]
    reviewer: str
    review_date: str
    notes: Optional[str]
    approved_hash: str


def compute_approved_hash(content_bytes: bytes, metadata_dict: Dict[str, Any]) -> str:
    """Compute deterministic SHA-256 of document file content and reviewed metadata."""
    hasher = hashlib.sha256()
    hasher.update(content_bytes)
    # Serialize metadata deterministically
    canonical_meta = json.dumps(metadata_dict, sort_keys=True, ensure_ascii=False)
    hasher.update(canonical_meta.encode('utf-8'))
    return hasher.hexdigest()


def validate_for_publication(
    instance_id: str,
    doc: Dict[str, Any],
    file_bytes: bytes,
    catalog_tags: Dict[int, str],
    catalog_doc_types: Dict[int, str],
    catalog_fields: Dict[int, str],
) -> ValidatedDocument:
    """Validate all preconditions required before a document may leave Paperless."""
    doc_id = doc.get('id')
    if not doc_id:
        raise ValidationError('Document must have an id')

    sync_key = f'{instance_id}:{doc_id}'

    # 1. Map tags and verify inbox tag is absent
    doc_tag_ids = doc.get('tags', [])
    doc_tag_names = [catalog_tags.get(tid, '') for tid in doc_tag_ids]

    if INBOX_TAG in doc_tag_names:
        raise ValidationError(f'Document {sync_key} still has inbox tag: "{INBOX_TAG}"')

    # 2. Exactly one section tag
    matched_sections = [name for name in doc_tag_names if name in SECTIONS]
    if len(matched_sections) != 1:
        raise ValidationError(
            f'Document {sync_key} must have exactly one section tag, found {len(matched_sections)}: {matched_sections}'
        )
    section = matched_sections[0]

    # 3. Document type
    doc_type_id = doc.get('document_type')
    doc_type = catalog_doc_types.get(doc_type_id)
    if not doc_type or doc_type not in DOCUMENT_TYPES:
        raise ValidationError(
            f'Document {sync_key} has invalid or missing document type: {doc_type}'
        )

    # 4. Map custom fields
    cf_entries = doc.get('custom_fields', [])
    cf_map = {}
    for entry in cf_entries:
        field_id = entry.get('field')
        field_name = catalog_fields.get(field_id)
        if field_name:
            cf_map[field_name] = entry.get('value')

    # 5. Check 'معتمد للمزامنة' is strictly True
    if cf_map.get('معتمد للمزامنة') is not True:
        raise ValidationError(f'Document {sync_key} is not approved for sync (معتمد للمزامنة is not True)')

    # 6. Check required fields
    for field_name in REQUIRED_FIELDS:
        val = cf_map.get(field_name)
        if val is None or (isinstance(val, str) and not val.strip()):
            raise ValidationError(f'Document {sync_key} missing required field: "{field_name}"')

    title = (doc.get('title') or '').strip()
    if not title:
        raise ValidationError(f'Document {sync_key} missing title (الموضوع)')

    created_date = (doc.get('created') or doc.get('created_date') or '')[:10]
    if not created_date:
        raise ValidationError(f'Document {sync_key} missing creation date (تاريخ الكتاب)')

    # Build canonical reviewed metadata snapshot for hashing
    snapshot = {
        'title': title,
        'created_date': created_date,
        'section': section,
        'doc_type': doc_type,
        'doc_number': str(cf_map['رقم الكتاب']),
        'sender': str(cf_map['الجهة المرسلة']),
        'recipient': str(cf_map['الجهة المستلمة']),
        'incoming_date': str(cf_map.get('تاريخ الورود') or ''),
        'entry_number': str(cf_map.get('رقم القيد') or ''),
        'reviewer': str(cf_map['راجعه']),
        'review_date': str(cf_map['تاريخ المراجعة']),
        'notes': str(cf_map.get('ملاحظات') or ''),
    }

    approved_hash = compute_approved_hash(file_bytes, snapshot)

    return ValidatedDocument(
        instance_id=instance_id,
        document_id=doc_id,
        sync_key=sync_key,
        section=section,
        doc_type=doc_type,
        title=title,
        created_date=created_date,
        doc_number=str(cf_map['رقم الكتاب']),
        sender=str(cf_map['الجهة المرسلة']),
        recipient=str(cf_map['الجهة المستلمة']),
        incoming_date=cf_map.get('تاريخ الورود'),
        entry_number=cf_map.get('رقم القيد'),
        reviewer=str(cf_map['راجعه']),
        review_date=str(cf_map['تاريخ المراجعة']),
        notes=cf_map.get('ملاحظات'),
        approved_hash=approved_hash,
    )


def format_sheets_row(
    vdoc: ValidatedDocument,
    drive_file_url: str,
    paperless_base_url: str,
    sync_timestamp: str,
) -> List[Any]:
    """Format row for Google Sheets according to the official schema in docs/integration-plan.md."""
    paperless_doc_url = f'{paperless_base_url.rstrip("/")}/documents/{vdoc.document_id}/details'
    return [
        vdoc.sync_key,                    # 1. مفتاح المصدر
        vdoc.section,                     # 2. القسم
        vdoc.doc_type,                    # 3. الوارد/الصادر/الداخلي
        vdoc.doc_number,                  # 4. رقم الكتاب (نص يحفظ الأصفار والرموز)
        vdoc.title,                       # 5. الموضوع
        vdoc.created_date,                # 6. تاريخ الكتاب
        vdoc.sender,                      # 7. المرسل
        vdoc.recipient,                   # 8. المستلم
        vdoc.incoming_date or '',         # 9. تاريخ الورود
        vdoc.entry_number or '',          # 10. رقم القيد
        vdoc.reviewer,                    # 11. المراجع
        vdoc.review_date,                 # 12. تاريخ المراجعة
        drive_file_url,                   # 13. رابط Drive
        paperless_doc_url,                # 14. رابط Paperless (ملاحظة: localhost يعمل محلياً فقط)
        vdoc.approved_hash,               # 15. بصمة النسخة
        sync_timestamp,                   # 16. وقت المزامنة
    ]
