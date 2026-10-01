# NAS Archive 2.2.1

Stabilization release for the native desktop architecture.

## Fixed

- Removed legacy Docker/Paperless service aliases from runtime health reporting.
- Removed the obsolete localhost HTTP health fallback.
- Corrected dashboard and settings health indicators to report Native Core and SQLite integrity.
- Removed stale Paperless wording from scanner error handling and runtime UI.
- Removed hard-coded native engine version labels that could drift from the packaged version.

## Improved

- Added a dedicated SQLite integrity indicator to the dashboard.
- Rewrote the operational README around the current Electron + SQLite + OCR + NAPS2 architecture.
- Replaced legacy Docker backup instructions with the native backup/restore workflow.
- Added a regression test that blocks reintroduction of legacy runtime health aliases.

## Compatibility

The Paperless migration engine remains available only for importing historical snapshots into the native archive. It is not a runtime backend.

## Verification

Release publication is gated by GitHub Actions:
- JavaScript syntax verification
- JavaScript regression suite
- Python CI
- Windows NSIS packaging
- Installer artifact verification
