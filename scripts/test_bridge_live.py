"""Verify live Scanner Bridge integration: Import -> Paperless Ingest -> OCR -> Done."""
import base64
import io
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

sys.stdout.reconfigure(encoding='utf-8')

# 1. Create a clean test image PDF
img = Image.new('RGB', (1200, 1600), color='white')
draw = ImageDraw.Draw(img)
draw.text((100, 150), 'NAS Archive Scanner Bridge Integration Test', fill='black')
draw.text((100, 250), 'Department: Al-Raneen Section', fill='black')
draw.text((100, 350), 'Official Number: 0099/BR-2026', fill='black')
draw.text((100, 450), 'Token: LIVE_BRIDGE_VERIFY_TOKEN_9988', fill='black')

buf = io.BytesIO()
img.save(buf, 'PDF', resolution=150.0)
pdf_bytes = buf.getvalue()

timestamp = int(time.time())
filename = f'bridge_verify_{timestamp}.pdf'

payload = {
    'filename': filename,
    'section': 'الرنين',
    'file_data': base64.b64encode(pdf_bytes).decode('ascii'),
    'allow_duplicate': True,
}

req = Request(
    'http://127.0.0.1:8001/api/import',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST'
)

print(f'Sending import request for {filename}...')
with urlopen(req, timeout=10) as resp:
    res = json.load(resp)
    task_id = res['task_id']
    print(f'Import enqueued successfully: task_id={task_id}')

# Poll task
final_task = None
for i in range(45):
    time.sleep(2)
    with urlopen(f'http://127.0.0.1:8001/api/tasks/{task_id}', timeout=10) as t_resp:
        task = json.load(t_resp)
        status = task.get('status')
        step = task.get('step')
        msg = task.get('message')
        print(f'[{i*2}s] Status: {status} (Step {step}/5): {msg}')
        if status in ('SUCCESS', 'FAILED', 'DUPLICATE'):
            final_task = task
            break

if not final_task:
    raise TimeoutError('Task polling timed out before reaching a terminal status.')

if final_task['status'] != 'SUCCESS':
    raise RuntimeError(f'Task ended with unexpected status {final_task["status"]}: {final_task.get("error")}')

res_data = final_task['result']
doc_id = res_data['document_id']
paperless_url = res_data['paperless_url']
print('\n======================================================')
print('LIVE SCANNER BRIDGE VERIFICATION SUCCEEDED!')
print(f'  - Paperless Document ID: {doc_id}')
print(f'  - Paperless URL: {paperless_url}')
print(f'  - SHA-256: {res_data.get("sha256")}')
print(f'  - Section: {res_data.get("section")}')
print(f'  - OCR Preview: {res_data.get("ocr_preview")[:100]}...')
print('======================================================\n')
