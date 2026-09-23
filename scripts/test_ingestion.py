"""Exercise synthetic OCR samples against the running local Paperless instance."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from bootstrap import Client

ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    credentials = json.loads((ROOT / 'runtime/admin-login.json').read_text())
    payload = {key: credentials[key] for key in ('username', 'password')}
    request = Request('http://localhost:8000/api/token/', data=json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        token = json.load(response)['token']
    client = Client('http://localhost:8000', token)
    tags = {item['name']: item for item in client.list_all('tags')}
    assert tags['بانتظار المراجعة']['is_inbox_tag'] is True
    samples = [('ar', 'شخصي', 'العربي'), ('en', 'NAS FM', 'Searchable')]
    report = []
    for lang, section, phrase in samples:
        title = f'nas-acceptance-{lang}'
        source = ROOT / 'runtime/staging' / (title + '.png')
        destination = ROOT / 'runtime/consume' / section / source.name
        assert source.exists(), 'Run New-OcrSamples.ps1 first'
        docs = client.list_all('documents')
        found = [doc for doc in docs if doc['title'] == title]
        if not found and not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix('.partial')
            shutil.copyfile(source, temporary)
            temporary.replace(destination)
        deadline = time.monotonic() + 240
        while not found and time.monotonic() < deadline:
            time.sleep(5)
            found = [doc for doc in client.list_all('documents') if doc['title'] == title]
        assert len(found) == 1, f'Expected one sample: {title}'
        document = found[0]
        assert phrase.casefold() in document['content'].casefold(), f'OCR phrase missing: {title}'
        assert tags[section]['id'] in document['tags'], f'Section missing: {title}'
        assert tags['بانتظار المراجعة']['id'] in document['tags'], f'Inbox missing: {title}'
        assert not destination.exists(), f'Consume file still present: {title}'
        results = client.request('documents/?' + urlencode({'query': phrase}))
        assert document['id'] in [doc['id'] for doc in results['results']], 'Search missed sample'
        for original in (True, False):
            url = client.base + f'documents/{document["id"]}/download/'
            if original:
                url += '?original=true'
            request = Request(url, headers={'Authorization': f'Token {token}'})
            with urlopen(request, timeout=30) as response:
                data = response.read()
            if original:
                assert hashlib.sha256(data).digest() == hashlib.sha256(source.read_bytes()).digest()
            else:
                assert data.startswith(b'%PDF'), 'Archive is not PDF'
        report.append({'id': document['id'], 'title': title, 'section': section,
                       'ocr_content': document['content'], 'search': 'PASS', 'downloads': 'PASS'})
        print(f'PASS {title}: OCR, section, inbox, search, original checksum and archived PDF')
    (ROOT / 'runtime/ingestion-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
