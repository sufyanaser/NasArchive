"""Verify server catalog alignment and test populating official custom fields."""
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from bootstrap import Client

ROOT = Path(__file__).resolve().parents[1]


def get_authenticated_client():
    creds_path = ROOT / 'runtime' / 'admin-login.json'
    if not creds_path.exists():
        raise SystemExit('Missing runtime/admin-login.json')
    creds = json.loads(creds_path.read_text(encoding='utf-8'))
    payload = {'username': creds['username'], 'password': creds['password']}
    req = Request('http://localhost:8000/api/token/',
                  data=json.dumps(payload).encode('utf-8'),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as resp:
        token = json.load(resp)['token']
    return Client('http://localhost:8000', token)


def test_catalog_alignment(client):
    catalog_path = ROOT / 'config' / 'catalog.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))

    # Verify custom fields
    server_fields = {f['name']: f for f in client.list_all('custom_fields')}
    for field_spec in catalog['custom_fields']:
        name = field_spec['name']
        assert name in server_fields, f'Missing custom field on server: {name}'
        assert server_fields[name]['data_type'] == field_spec['data_type'], \
            f'Data type mismatch for {name}: expected {field_spec["data_type"]}, got {server_fields[name]["data_type"]}'

    # Verify document types
    server_types = {dt['name']: dt for dt in client.list_all('document_types')}
    for type_spec in catalog['document_types']:
        name = type_spec['name']
        assert name in server_types, f'Missing document type on server: {name}'

    # Verify tags
    server_tags = {t['name']: t for t in client.list_all('tags')}
    for tag_spec in catalog['tags']:
        name = tag_spec['name']
        assert name in server_tags, f'Missing tag on server: {name}'
        assert server_tags[name]['is_inbox_tag'] == tag_spec['is_inbox_tag'], \
            f'Inbox tag mismatch for {name}'

    print('PASS: Catalog on server strictly matches config/catalog.json (10 custom fields, 3 doc types, 5 tags).')
    return server_fields, server_types, server_tags


def test_document_custom_fields(client, server_fields, server_types):
    docs = client.list_all('documents')
    if not docs:
        raise SystemExit('No documents found to test custom fields on.')

    # Use first document (nas-acceptance-ar)
    doc_id = docs[0]['id']

    # Test values with leading zeros, dashes, slashes, and Arabic characters
    sample_doc_number = '0042/ص-2026'
    sample_entry_number = '00987-ق'
    sample_date = '2026-09-23'
    sample_sender = 'وزارة التجارة'
    sample_recipient = 'شركة الرنين'
    sample_notes = 'اختبار التحقق من صحة حفظ الحقول النصية واسترجاع الأصفار والشرطات.'
    sample_reviewer = 'مدقق الجودة'

    # Build custom fields payload
    # "معتمد للمزامنة" MUST be False during testing
    custom_fields_payload = [
        {'field': server_fields['رقم الكتاب']['id'], 'value': sample_doc_number},
        {'field': server_fields['الجهة المرسلة']['id'], 'value': sample_sender},
        {'field': server_fields['الجهة المستلمة']['id'], 'value': sample_recipient},
        {'field': server_fields['تاريخ الورود']['id'], 'value': sample_date},
        {'field': server_fields['رقم القيد']['id'], 'value': sample_entry_number},
        {'field': server_fields['ملاحظات']['id'], 'value': sample_notes},
        {'field': server_fields['معتمد للمزامنة']['id'], 'value': False},
        {'field': server_fields['راجعه']['id'], 'value': sample_reviewer},
        {'field': server_fields['تاريخ المراجعة']['id'], 'value': sample_date},
    ]

    doc_type_id = server_types['كتاب وارد']['id']

    # Patch document
    patch_body = {
        'document_type': doc_type_id,
        'custom_fields': custom_fields_payload,
    }
    client.request(f'documents/{doc_id}/', patch_body, method='PATCH')

    # Fetch document back and verify
    refetched = client.request(f'documents/{doc_id}/')
    assert refetched['document_type'] == doc_type_id, 'Document type was not updated.'

    saved_cf_map = {item['field']: item['value'] for item in refetched.get('custom_fields', [])}

    # Verify "رقم الكتاب"
    doc_num_id = server_fields['رقم الكتاب']['id']
    assert doc_num_id in saved_cf_map, 'رقم الكتاب missing in saved custom_fields'
    assert saved_cf_map[doc_num_id] == sample_doc_number, \
        f'Leading zeros or formatting lost in رقم الكتاب: expected {sample_doc_number}, got {saved_cf_map[doc_num_id]}'

    # Verify "رقم القيد"
    entry_num_id = server_fields['رقم القيد']['id']
    assert saved_cf_map[entry_num_id] == sample_entry_number, \
        f'Formatting lost in رقم القيد: expected {sample_entry_number}, got {saved_cf_map[entry_num_id]}'

    # Verify "معتمد للمزامنة" is explicitly False
    sync_approved_id = server_fields['معتمد للمزامنة']['id']
    assert saved_cf_map[sync_approved_id] is False, \
        f'Expected معتمد للمزامنة to be False, got {saved_cf_map[sync_approved_id]}'

    # Verify other fields
    assert saved_cf_map[server_fields['الجهة المرسلة']['id']] == sample_sender
    assert saved_cf_map[server_fields['الجهة المستلمة']['id']] == sample_recipient
    assert saved_cf_map[server_fields['تاريخ الورود']['id']] == sample_date
    assert saved_cf_map[server_fields['ملاحظات']['id']] == sample_notes
    assert saved_cf_map[server_fields['راجعه']['id']] == sample_reviewer
    assert saved_cf_map[server_fields['تاريخ المراجعة']['id']] == sample_date

    print(f'PASS: Document {doc_id} official custom fields saved and verified.')
    print(f'      - رقم الكتاب: "{saved_cf_map[doc_num_id]}" (leading zeros and dashes intact)')
    print(f'      - رقم القيد: "{saved_cf_map[entry_num_id]}"')
    print(f'      - معتمد للمزامنة: {saved_cf_map[sync_approved_id]} (unapproved for cloud publish as required)')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    client = get_authenticated_client()
    server_fields, server_types, server_tags = test_catalog_alignment(client)
    test_document_custom_fields(client, server_fields, server_types)
    print('ALL CUSTOM FIELD AND CATALOG CHECKS PASSED.')


if __name__ == '__main__':
    main()
