"""Create a local administrator and apply the catalog without logging credentials."""
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys

from bootstrap import Client, reconcile, CATALOG

ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    docker = shutil.which('docker') or r'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
    credentials_path = ROOT / 'runtime' / 'admin-login.json'
    credentials_path.parent.mkdir(parents=True, exist_ok=True)
    if not credentials_path.exists():
        credentials = {'username': 'nasadmin', 'password': secrets.token_urlsafe(32),
                       'url': 'http://localhost:8000'}
        with credentials_path.open('x', encoding='utf-8') as file:
            json.dump(credentials, file, indent=2)
    credentials = json.loads(credentials_path.read_text(encoding='utf-8'))
    command = '''
import json
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from guardian.shortcuts import get_anonymous_user
credentials = json.loads(PAYLOAD)
User = get_user_model()
user = User.objects.filter(username=credentials['username']).first()
if user is None:
    if User.objects.exclude(pk=get_anonymous_user().pk).exists():
        raise RuntimeError('Existing users found; use the existing administrator and bootstrap.py instead')
    user = User.objects.create_superuser(username=credentials['username'], password=credentials['password'], email='')
if not user.check_password(credentials['password']) or not user.is_superuser:
    raise RuntimeError('Existing administrator differs; no password was changed')
token, _ = Token.objects.get_or_create(user=user)
print('NAS_TOKEN=' + token.key)
'''.replace('PAYLOAD', repr(json.dumps(credentials)))
    result = subprocess.run([docker, 'compose', 'exec', '-T', 'webserver',
                             'python', 'manage.py', 'shell'], input=command,
                            text=True, capture_output=True, cwd=ROOT, encoding='utf-8')
    if result.returncode:
        raise SystemExit('Local provisioning failed; existing credentials were not reset. Inspect the service/account state.')
    tokens = [line.partition('NAS_TOKEN=')[2] for line in result.stdout.splitlines() if line.startswith('NAS_TOKEN=')]
    if len(tokens) != 1:
        raise SystemExit('Provisioning returned no token; no output containing credentials was logged.')
    client = Client('http://localhost:8000', tokens[0])
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    created = reconcile(client, catalog, apply=True)
    if reconcile(client, catalog) != 0:
        raise SystemExit('Catalog verification failed')
    print(f'Catalog verified; {created} objects created. Credentials: runtime/admin-login.json (local only).')


if __name__ == '__main__':
    main()
