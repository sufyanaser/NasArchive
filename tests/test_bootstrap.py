import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bootstrap', ROOT / 'scripts/bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class FakeClient:
    def __init__(self, catalog):
        self.rows = {key: [] for key in catalog}
        self.posts = []

    def list_all(self, endpoint):
        return self.rows[endpoint]

    def request(self, path, payload):
        self.posts.append((path, payload))
        self.rows[path.strip('/')].append(copy.deepcopy(payload))


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(bootstrap.CATALOG.read_text(encoding='utf-8'))
        self.client = FakeClient(self.catalog)

    def run_reconcile(self, apply=False):
        with contextlib.redirect_stdout(io.StringIO()):
            return bootstrap.reconcile(self.client, self.catalog, apply)

    def test_plan_does_not_write(self):
        self.assertGreater(self.run_reconcile(), 0)
        self.assertEqual(self.client.posts, [])

    def test_apply_is_repeatable(self):
        count = self.run_reconcile(True)
        self.assertEqual(len(self.client.posts), count)
        self.assertEqual(self.run_reconcile(True), 0)
        self.assertEqual(len(self.client.posts), count)

    def test_conflict_prevents_all_writes(self):
        field = dict(self.catalog['custom_fields'][0], data_type='integer')
        self.client.rows['custom_fields'].append(field)
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.run_reconcile(True)
        self.assertEqual(self.client.posts, [])

    def test_duplicate_name_prevents_writes(self):
        tag = self.catalog['tags'][0]
        self.client.rows['tags'] = [tag, tag]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.run_reconcile(True)
        self.assertEqual(self.client.posts, [])

    def test_pagination(self):
        client = bootstrap.Client('http://localhost:8000', 'test')
        pages = iter([{'results': [{'id': 1}], 'next': 'http://localhost:8000/api/tags/?page=2'},
                      {'results': [{'id': 2}], 'next': None}])
        client.request = lambda page: next(pages)
        self.assertEqual(client.list_all('tags'), [{'id': 1}, {'id': 2}])

    def test_cross_origin_rejected_before_network(self):
        client = bootstrap.Client('http://localhost:8000', 'test')
        for url in ['https://example.com/api/tags/', 'https://localhost:8000/api/tags/']:
            with self.assertRaisesRegex(ValueError, 'cross-origin'):
                client.request(url)

    def test_pagination_cycle_stops(self):
        client = bootstrap.Client('http://localhost:8000', 'test')
        client.request = lambda page: {'results': [], 'next': 'tags/'}
        with self.assertRaisesRegex(ValueError, 'Repeated'):
            client.list_all('tags')


if __name__ == '__main__':
    unittest.main()
