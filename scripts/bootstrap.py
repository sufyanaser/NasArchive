"""Create the NAS catalog through the public API; default is a read-only plan."""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

CATALOG = Path(__file__).resolve().parents[1] / 'config' / 'catalog.json'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('API redirects are not allowed')


class Client:
    def __init__(self, base, token):
        self.base = base.rstrip('/') + '/api/'
        self.token = token
        self.opener = build_opener(NoRedirect)

    def request(self, path, payload=None, method=None):
        url = urljoin(self.base, path)
        if urlsplit(url).netloc != urlsplit(self.base).netloc or urlsplit(url).scheme != urlsplit(self.base).scheme:
            raise ValueError('Refusing a cross-origin API URL')
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        kwargs = {'method': method} if method else {}
        req = Request(url, data=data, headers={
            'Authorization': f'Token {self.token}', 'Content-Type': 'application/json'},
            **kwargs)
        with self.opener.open(req, timeout=30) as response:
            return json.load(response)

    def list_all(self, endpoint):
        result, seen = [], set()
        page = endpoint + '/'
        while page:
            if page in seen:
                raise ValueError('Repeated pagination URL')
            seen.add(page)
            response = self.request(page)
            result.extend(response['results'])
            page = response.get('next')
        return result


def reconcile(client, catalog, apply=False):
    # Preflight every collection before creating anything. Never overwrite a conflict.
    missing = []
    for endpoint, desired in catalog.items():
        existing = client.list_all(endpoint)
        for item in desired:
            matches = [x for x in existing if x['name'] == item['name']]
            if len(matches) > 1:
                raise ValueError(f'Duplicate name in {endpoint}: {item["name"]}')
            if matches:
                if any(matches[0].get(k) != v for k, v in item.items()):
                    raise ValueError(f'Configuration conflict: {item["name"]}')
            else:
                missing.append((endpoint, item))
    for endpoint, item in missing:
        if apply:
            client.request(endpoint + '/', item)
        print(('Created' if apply else 'Would create'), endpoint, item['name'])
    return len(missing)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = os.environ.get('PAPERLESS_API_TOKEN')
    if not token:
        parser.error('Set PAPERLESS_API_TOKEN in the current process first')
    client = Client('http://localhost:8000', token)
    try:
        reconcile(client, json.loads(CATALOG.read_text(encoding='utf-8')), args.apply)
    except HTTPError as exc:
        parser.exit(1, f'API HTTP {exc.code}; no credentials or response body logged. Rerun after fixing the cause.\n')
    except (URLError, ValueError) as exc:
        parser.exit(1, f'Bootstrap stopped: {exc}\n')


if __name__ == '__main__':
    main()
