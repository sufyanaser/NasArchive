"""Compare the local archive with an isolated restore on localhost:18000."""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bootstrap import Client

ROOT = Path(__file__).resolve().parents[1]


def connect(port):
    credentials = json.loads((ROOT / 'runtime/admin-login.json').read_text())
    payload = {key: credentials[key] for key in ('username', 'password')}
    url = f'http://localhost:{port}'
    request = Request(url + '/api/token/', data=json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return Client(url, json.load(response)['token'])


def digest(client, document_id, original):
    url = client.base + f'documents/{document_id}/download/'
    if original:
        url += '?original=true'
    request = Request(url, headers={'Authorization': f'Token {client.token}'})
    with urlopen(request, timeout=30) as response:
        return hashlib.sha256(response.read()).hexdigest()


def main():
    source, restored = connect(8000), connect(18000)
    for endpoint, keys in (
        ('tags', ('id', 'name', 'is_inbox_tag', 'matching_algorithm')),
        ('document_types', ('id', 'name', 'matching_algorithm')),
        ('custom_fields', ('id', 'name', 'data_type', 'extra_data')),
        ('documents', ('id', 'title', 'content', 'tags', 'custom_fields', 'owner')),
    ):
        def snapshot(client):
            return sorted([{k: item[k] for k in keys} for item in client.list_all(endpoint)], key=lambda x: x['id'])
        assert snapshot(source) == snapshot(restored), f'Restore mismatch: {endpoint}'
    docs = source.list_all('documents')
    assert len(docs) == 2, 'This acceptance comparison expects the two synthetic documents only'
    checksums = []
    for document in docs:
        for original in (True, False):
            expected = digest(source, document['id'], original)
            assert expected == digest(restored, document['id'], original), 'Restored file checksum mismatch'
            checksums.append({'document_id': document['id'], 'original': original, 'sha256': expected})
    for phrase in ('العربي', 'Searchable'):
        result = restored.request('documents/?' + urlencode({'query': phrase}))
        assert result['count'] >= 1, 'Restored search failed'
    (ROOT / 'runtime/restore-results.json').write_text(json.dumps({'result': 'PASS', 'checksums': checksums}, indent=2), encoding='utf-8')
    print('PASS: restored login, catalog, document metadata/content, original/archive hashes and bilingual search.')


if __name__ == '__main__':
    main()
