"""Intelligent Arabic and English document processor for NAS Archive.
Extracts official metadata (titles, reference numbers, dates, parties, departments)
with confidence scoring, missing-metadata detection, and human-in-the-loop safeguards.
"""
import argparse
from dataclasses import asdict, dataclass, field
from datetime import datetime
import json
import logging
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen

from bootstrap import Client

ROOT = Path(__file__).resolve().parents[1]

DEPARTMENTS = ('شخصي', 'الرنين', 'تناسق', 'NAS FM')
DOC_TYPES = ('كتاب وارد', 'كتاب صادر', 'كتاب داخلي')

DEPARTMENT_KEYWORDS = {
    'الرنين': [r'\bالرنين\b', r'\bرنين\b', r'\bal-raneen\b', r'\braneen\b'],
    'تناسق': [r'\bتناسق\b', r'\btanasaq\b'],
    'NAS FM': [r'\bnas\s*fm\b', r'\bإذاعة\b', r'\bراديو\b', r'\bfm\b'],
    'شخصي': [r'\bشخصي\b', r'\bخاص\b', r'\bعقد إيجار\b', r'\bبطاقة وطنية\b', r'\bجواز\b'],
}


@dataclass
class ExtractionResult:
    value: Any
    confidence: float  # 0.0 to 1.0
    source: str        # 'pattern', 'keyword', 'fallback'


@dataclass
class DocumentAnalysis:
    document_id: int
    title_suggestion: ExtractionResult
    doc_type_suggestion: ExtractionResult
    department_suggestion: ExtractionResult
    doc_number_suggestion: ExtractionResult
    entry_number_suggestion: ExtractionResult
    doc_date_suggestion: ExtractionResult
    incoming_date_suggestion: ExtractionResult
    sender_suggestion: ExtractionResult
    recipient_suggestion: ExtractionResult
    missing_fields: List[str]
    ready_for_review: bool
    ai_approved_sync: bool = False  # GUARANTEE: Never True automatically


class ArabicDocumentAnalyzer:
    """Heuristic rule-based and NLP pattern analyzer for official Iraqi/Arabic administrative documents."""

    @staticmethod
    def extract_document_number(text: str) -> ExtractionResult:
        # Match official numbers with leading zeros, dashes, slashes, e.g., "0042/ص-2026" or "العدد: 1234/ب/2026"
        patterns = [
            (r'(?:العدد|رقم\s*الكتاب|الرقم|رقم)\s*[:/]\s*([0-9A-Za-z\u0600-\u06FF\-_/]{3,30})', 0.95),
            (r'\b([0-9]{3,6}/[\u0600-\u06FF\-_/]+/[0-9]{4})\b', 0.90),
            (r'\b([0-9]{2,6}/[0-9]{4})\b', 0.80),
            (r'(?:رقم\s*الكتاب)\s*([0-9]{3,8})', 0.85),
        ]
        for pattern, conf in patterns:
            match = re.search(pattern, text)
            if match:
                val = match.group(1).strip()
                if len(val) >= 3:
                    return ExtractionResult(value=val, confidence=conf, source='pattern')
        return ExtractionResult(value='', confidence=0.0, source='none')

    @staticmethod
    def extract_entry_number(text: str) -> ExtractionResult:
        patterns = [
            (r'(?:رقم\s*القيد|قيد\s*رقم|القيد)\s*[:/]\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})', 0.90),
            (r'(?:وارد\s*قيد)\s*([0-9A-Za-z\u0600-\u06FF\-_/]{2,20})', 0.85),
        ]
        for pattern, conf in patterns:
            match = re.search(pattern, text)
            if match:
                return ExtractionResult(value=match.group(1).strip(), confidence=conf, source='pattern')
        return ExtractionResult(value='', confidence=0.0, source='none')

    @staticmethod
    def extract_dates(text: str) -> Tuple[ExtractionResult, ExtractionResult]:
        # Dates in formats YYYY-MM-DD or DD/MM/YYYY or YYYY/MM/DD
        date_pattern = r'\b(20[2-3][0-9][\-/](?:0[1-9]|1[0-2])[\-/](?:0[1-9]|[12][0-9]|3[01])|(?:0[1-9]|[12][0-9]|3[01])[\-/](?:0[1-9]|1[0-2])[\-/]20[2-3][0-9])\b'
        matches = list(re.finditer(date_pattern, text))

        def normalize(d_str: str) -> str:
            d_str = d_str.replace('/', '-')
            parts = d_str.split('-')
            if len(parts[0]) == 4:
                return f'{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}'
            return f'{parts[2]}-{int(parts[1]):02d}-{int(parts[0]):02d}'

        doc_date = ExtractionResult(value='', confidence=0.0, source='none')
        incoming_date = ExtractionResult(value='', confidence=0.0, source='none')

        # Check for specific incoming date prefix
        inc_match = re.search(r'(?:تاريخ\s*الورود|ورد\s*بتاريخ)\s*[:/]?\s*' + date_pattern, text)
        if inc_match:
            incoming_date = ExtractionResult(value=normalize(inc_match.group(1)), confidence=0.95, source='pattern')

        if matches:
            first_date = normalize(matches[0].group(1))
            doc_date = ExtractionResult(value=first_date, confidence=0.85, source='pattern')
            if len(matches) > 1 and not incoming_date.value:
                second_date = normalize(matches[1].group(1))
                incoming_date = ExtractionResult(value=second_date, confidence=0.70, source='pattern')

        return doc_date, incoming_date

    @staticmethod
    def extract_subject_or_title(text: str, fallback_title: str) -> ExtractionResult:
        patterns = [
            (r'(?:الموضوع|م/\s*|بشأن)\s*[:/]\s*([^\n\r\.]{4,100})', 0.95),
            (r'(?:مذكرة\s*تفاهم[^\n\r\.]{0,60})', 0.90),
            (r'(?:أمر\s*إداري[^\n\r\.]{0,60})', 0.90),
            (r'(?:كتاب\s*شكر[^\n\r\.]{0,60})', 0.90),
        ]
        for pattern, conf in patterns:
            match = re.search(pattern, text)
            if match:
                val = match.group(1).strip() if match.groups() else match.group(0).strip()
                return ExtractionResult(value=val, confidence=conf, source='pattern')

        # Fallback to non-empty lines if title is generic
        if fallback_title and not fallback_title.startswith('scan_') and not fallback_title.startswith('doc_'):
            return ExtractionResult(value=fallback_title, confidence=0.60, source='existing')

        lines = [line.strip() for line in text.splitlines() if len(line.strip()) >= 5]
        if lines:
            return ExtractionResult(value=lines[0][:80], confidence=0.40, source='first_line')

        return ExtractionResult(value='مستند غير معنون', confidence=0.10, source='fallback')

    @staticmethod
    def extract_parties(text: str) -> Tuple[ExtractionResult, ExtractionResult]:
        sender = ExtractionResult(value='', confidence=0.0, source='none')
        recipient = ExtractionResult(value='', confidence=0.0, source='none')

        sender_match = re.search(r'(?:من|الجهة\s*المرسلة|صادر\s*من)\s*[:/]\s*([^\n\r\.]{3,50})', text)
        if sender_match:
            sender = ExtractionResult(value=sender_match.group(1).strip(), confidence=0.90, source='pattern')

        recipient_match = re.search(r'(?:إلى|الجهة\s*المستلمة|السيد|السادة)\s*[:/]\s*([^\n\r\.]{3,50})', text)
        if recipient_match:
            recipient = ExtractionResult(value=recipient_match.group(1).strip(), confidence=0.90, source='pattern')

        return sender, recipient

    @classmethod
    def classify_department(cls, text: str) -> ExtractionResult:
        lower_text = text.lower()
        for dept, patterns in DEPARTMENT_KEYWORDS.items():
            for pat in patterns:
                if re.search(pat, lower_text, re.IGNORECASE):
                    return ExtractionResult(value=dept, confidence=0.85, source='keyword')
        return ExtractionResult(value='شخصي', confidence=0.40, source='default_fallback')

    @classmethod
    def classify_document_type(cls, text: str) -> ExtractionResult:
        if re.search(r'\b(وارد|كتابكم|إشارة\s*إلى\s*كتابكم)\b', text):
            return ExtractionResult(value='كتاب وارد', confidence=0.85, source='keyword')
        if re.search(r'\b(صادر|نرجو\s*التفضل|يرجى\s*التفضل)\b', text):
            return ExtractionResult(value='كتاب صادر', confidence=0.80, source='keyword')
        if re.search(r'\b(مذكرة\s*داخلية|تعميم\s*داخلي|إلى\s*كافة\s*الأقسام)\b', text):
            return ExtractionResult(value='كتاب داخلي', confidence=0.85, source='keyword')
        return ExtractionResult(value='كتاب وارد', confidence=0.50, source='default')

    @classmethod
    def analyze_document(cls, doc_id: int, content: str, title: str) -> DocumentAnalysis:
        doc_num = cls.extract_document_number(content)
        entry_num = cls.extract_entry_number(content)
        doc_date, inc_date = cls.extract_dates(content)
        subject = cls.extract_subject_or_title(content, title)
        sender, recipient = cls.extract_parties(content)
        dept = cls.classify_department(content)
        dtype = cls.classify_document_type(content)

        missing = []
        if not doc_num.value or doc_num.confidence < 0.5:
            missing.append('رقم الكتاب')
        if not sender.value or sender.confidence < 0.5:
            missing.append('الجهة المرسلة')
        if not recipient.value or recipient.confidence < 0.5:
            missing.append('الجهة المستلمة')
        if not doc_date.value:
            missing.append('تاريخ الكتاب')
        if not subject.value:
            missing.append('الموضوع')

        return DocumentAnalysis(
            document_id=doc_id,
            title_suggestion=subject,
            doc_type_suggestion=dtype,
            department_suggestion=dept,
            doc_number_suggestion=doc_num,
            entry_number_suggestion=entry_num,
            doc_date_suggestion=doc_date,
            incoming_date_suggestion=inc_date,
            sender_suggestion=sender,
            recipient_suggestion=recipient,
            missing_fields=missing,
            ready_for_review=len(missing) == 0,
            ai_approved_sync=False,  # ALWAYS False!
        )


def apply_suggestions_to_paperless(client: Client, analysis: DocumentAnalysis) -> Dict[str, Any]:
    """Patch document with suggested fields for human review. Never approve sync."""
    doc_id = analysis.document_id
    server_fields = {f['name']: f['id'] for f in client.list_all('custom_fields')}
    server_types = {t['name']: t['id'] for t in client.list_all('document_types')}
    server_tags = {t['name']: t['id'] for t in client.list_all('tags')}

    cf_payload = []
    if analysis.doc_number_suggestion.value and 'رقم الكتاب' in server_fields:
        cf_payload.append({'field': server_fields['رقم الكتاب'], 'value': analysis.doc_number_suggestion.value})
    if analysis.entry_number_suggestion.value and 'رقم القيد' in server_fields:
        cf_payload.append({'field': server_fields['رقم القيد'], 'value': analysis.entry_number_suggestion.value})
    if analysis.incoming_date_suggestion.value and 'تاريخ الورود' in server_fields:
        cf_payload.append({'field': server_fields['تاريخ الورود'], 'value': analysis.incoming_date_suggestion.value})
    if analysis.sender_suggestion.value and 'الجهة المرسلة' in server_fields:
        cf_payload.append({'field': server_fields['الجهة المرسلة'], 'value': analysis.sender_suggestion.value})
    if analysis.recipient_suggestion.value and 'الجهة المستلمة' in server_fields:
        cf_payload.append({'field': server_fields['الجهة المستلمة'], 'value': analysis.recipient_suggestion.value})

    # ALWAYS set معتمد للمزامنة to False
    if 'معتمد للمزامنة' in server_fields:
        cf_payload.append({'field': server_fields['معتمد للمزامنة'], 'value': False})

    # Department tag + Inbox tag
    target_tags = []
    if analysis.department_suggestion.value in server_tags:
        target_tags.append(server_tags[analysis.department_suggestion.value])
    if 'بانتظار المراجعة' in server_tags:
        target_tags.append(server_tags['بانتظار المراجعة'])

    doc_type_id = server_types.get(analysis.doc_type_suggestion.value)

    patch_body = {
        'title': analysis.title_suggestion.value,
        'custom_fields': cf_payload,
        'tags': target_tags,
    }
    if doc_type_id:
        patch_body['document_type'] = doc_type_id
    if analysis.doc_date_suggestion.value:
        patch_body['created'] = analysis.doc_date_suggestion.value

    return client.request(f'documents/{doc_id}/', patch_body, method='PATCH')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doc-id', type=int, help='Analyze a specific document by ID')
    parser.add_argument('--apply', action='store_true', help='Apply suggestions as draft review metadata to Paperless')
    parser.add_argument('--audit-all', action='store_true', help='Audit all documents and report missing metadata')
    args = parser.parse_args()

    creds_path = ROOT / 'runtime' / 'admin-login.json'
    if not creds_path.exists():
        raise SystemExit('Missing runtime/admin-login.json')
    creds = json.loads(creds_path.read_text(encoding='utf-8'))
    req = Request('http://localhost:8000/api/token/',
                  data=json.dumps({'username': creds['username'], 'password': creds['password']}).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as resp:
        token = json.load(resp)['token']
    client = Client('http://localhost:8000', token)

    if args.doc_id:
        doc = client.request(f'documents/{args.doc_id}/')
        analysis = ArabicDocumentAnalyzer.analyze_document(
            doc_id=doc['id'],
            content=doc.get('content', ''),
            title=doc.get('title', '')
        )
        print(json.dumps(asdict(analysis), ensure_ascii=False, indent=2))
        if args.apply:
            res = apply_suggestions_to_paperless(client, analysis)
            print(f'Applied AI draft suggestions to document {args.doc_id} (معتمد للمزامنة: False).')
        return

    if args.audit_all:
        docs = client.list_all('documents')
        reports = []
        for doc in docs:
            analysis = ArabicDocumentAnalyzer.analyze_document(
                doc_id=doc['id'],
                content=doc.get('content', ''),
                title=doc.get('title', '')
            )
            reports.append(asdict(analysis))
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return

    parser.print_help()


if __name__ == '__main__':
    main()
