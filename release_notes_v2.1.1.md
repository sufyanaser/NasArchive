# NAS Archive v2.1.1 Release Notes

## Fixes

- Added an explicit `npm test` command for the GitHub Release workflow.
- Kept the default JavaScript test command focused on committed, self-contained regression suites.
- Scoped Python CI test discovery to `tests/` so live scanner bridge scripts under `scripts/` are not collected as unit tests.
- Preserved the live native verification script as an explicit command through `npm run test:native`.

## Validation

- JavaScript syntax checks passed for all committed `.js` files.
- Self-contained JavaScript regression tests passed.
- Windows NSIS installer build completed successfully.

## Not Verified

- Python compile, lint, and pytest were not verified locally because no usable Python interpreter is available in this shell.
- Physical scanner hardware validation was not performed as part of this release.
- `npm run test:native` requires the missing `runtime/export/live-snapshot-20260924/manifest.json` fixture for its final migration scenario.
