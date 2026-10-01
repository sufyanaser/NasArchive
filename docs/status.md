# NAS Archive — Current Status

## Runtime

NAS Archive يعمل كتطبيق Electron محلي. لا يعتمد التشغيل الحالي على Docker أو WSL أو Paperless-ngx.

المكونات التشغيلية:

- Native Electron Core.
- SQLite + WAL + FTS5.
- Native document storage.
- OCR عربي/إنجليزي.
- NAPS2 / WIA scanner integration.
- Secure IPC.
- GitHub Release auto-updater.

## Release baseline

- Version: 2.2.1
- Development source of truth: `develop`
- Windows installer: NSIS
- Release publishing: GitHub Actions
- Update feed: GitHub Releases

## Verification gates

قبل اعتماد أي Release:

1. `npm ci`
2. JavaScript syntax verification.
3. `npm test`
4. Windows packaging.
5. Installer artifact verification.
6. Python CI where applicable.

## Local verification still required

الاختبارات الآلية لا تستبدل الاختبارات الفيزيائية التالية:

- Epson/NAPS2 scan from a real device.
- OCR accuracy on representative Arabic documents.
- Backup then restore on a disposable test archive.
- Installed-app update flow between two published versions.
