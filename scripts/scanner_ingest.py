"""Scanner integration and document ingestion pipeline for NAS Archive."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
STAGING_DIR = ROOT / 'runtime' / 'staging'
CONSUME_DIR = ROOT / 'runtime' / 'consume'
ARCHIVE_DIR = ROOT / 'runtime' / 'scanned_archive'
CONFIG_DIR = ROOT / 'config'

VALID_SECTIONS = ('شخصي', 'الرنين', 'تناسق', 'NAS FM')

logger = logging.getLogger(__name__)


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of a file."""
    hasher = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def find_naps2_executable() -> Optional[str]:
    """Locate NAPS2.Console.exe on the system."""
    for cmd in ('NAPS2.Console.exe', 'naps2.console', 'naps2'):
        found = shutil.which(cmd)
        if found:
            return found
    common_locations = [
        Path(r'C:\Program Files\NAPS2\NAPS2.Console.exe'),
        Path(r'C:\Program Files (x86)\NAPS2\NAPS2.Console.exe'),
        Path.home() / r'AppData\Local\Programs\NAPS2\NAPS2.Console.exe',
        Path.home() / r'AppData\Local\Microsoft\WindowsApps\NAPS2.Console.exe',
    ]
    for path in common_locations:
        if path.exists():
            return str(path)
    return None


SUPPORTED_EXTENSIONS = {
    '.pdf': (b'%PDF',),
    '.png': (b'\x89PNG\r\n\x1a\n',),
    '.jpg': (b'\xff\xd8\xff',),
    '.jpeg': (b'\xff\xd8\xff',),
    '.tif': (b'II*\x00', b'MM\x00*'),
    '.tiff': (b'II*\x00', b'MM\x00*'),
}
VALID_SOURCES = ('glass', 'feeder', 'duplex')


def list_scanning_devices(driver: Optional[str] = None) -> Dict[str, List[str]]:
    """List detected scanning devices across WIA, TWAIN, and eSCL drivers."""
    naps2 = find_naps2_executable()
    if not naps2:
        return {}

    drivers = [driver] if driver else ['wia', 'twain', 'escl']
    results = {}
    for d in drivers:
        try:
            # WIA is local and instant; eSCL may take longer on network
            timeout = 5 if d in ('wia', 'twain') else 8
            proc = subprocess.run(
                [naps2, '--driver', d, '--listdevices'],
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding='utf-8',
                errors='replace'
            )
            devices = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
            results[d] = devices
        except (subprocess.TimeoutExpired, subprocess.SubprocessError) as exc:
            results[d] = [f'Error: {exc}']
    return results


def check_for_duplicate(sha256_hash: str) -> Optional[Path]:
    """Check if a document with identical hash already exists in scanned_archive."""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for existing in ARCHIVE_DIR.glob('*.*'):
        if existing.is_file():
            try:
                if compute_file_hash(existing) == sha256_hash:
                    return existing
            except OSError:
                continue
    return None


def ingest_file(
    source_path: Path,
    section: str,
    allow_duplicate: bool = False,
    preserve_archive: bool = True,
) -> Dict[str, Any]:
    """Safely ingest a PDF/image into Paperless consume folder after validation and archiving."""
    source_path = Path(source_path)
    if not source_path.exists():
        raise FileNotFoundError(f'Source file does not exist: {source_path}')

    if section not in VALID_SECTIONS:
        raise ValueError(f'Invalid section "{section}". Must be one of: {VALID_SECTIONS}')

    file_bytes = source_path.read_bytes()
    if not file_bytes:
        raise ValueError('Source file is empty.')

    ext = source_path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f'Unsupported file format "{ext}". Supported formats: {list(SUPPORTED_EXTENSIONS.keys())}')

    valid_headers = SUPPORTED_EXTENSIONS[ext]
    if not any(file_bytes.startswith(hdr) for hdr in valid_headers):
        if ext == '.pdf':
            raise ValueError('File has .pdf extension but lacks valid %PDF header.')
        raise ValueError(f'File has {ext} extension but lacks a valid header signature.')

    sha256_hash = compute_file_hash(source_path)

    # Duplicate check
    duplicate_match = check_for_duplicate(sha256_hash)
    if duplicate_match and not allow_duplicate:
        return {
            'status': 'DUPLICATE_REJECTED',
            'sha256': sha256_hash,
            'existing_file': str(duplicate_match),
            'message': f'Document is an exact duplicate of previously archived file: {duplicate_match.name}',
        }

    # Preserve original in scanned_archive
    archived_copy = None
    if preserve_archive:
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        archived_copy = ARCHIVE_DIR / f'{timestamp}_{sha256_hash[:8]}_{source_path.name}'
        shutil.copyfile(source_path, archived_copy)

    # Ingestion via atomic move into runtime/consume/<section>
    target_section_dir = CONSUME_DIR / section
    target_section_dir.mkdir(parents=True, exist_ok=True)
    destination_file = target_section_dir / source_path.name

    # Write to partial file first, then atomic rename
    partial_dest = destination_file.with_suffix(destination_file.suffix + '.part')
    shutil.copyfile(source_path, partial_dest)
    partial_dest.replace(destination_file)

    # If source was in staging, clean up staging file
    if STAGING_DIR in source_path.parents or source_path.parent == STAGING_DIR:
        try:
            source_path.unlink()
        except OSError:
            pass

    return {
        'status': 'INGESTED',
        'sha256': sha256_hash,
        'section': section,
        'archived_copy': str(archived_copy) if archived_copy else None,
        'consume_target': str(destination_file),
    }


def scan_to_staging(
    section: str,
    device: Optional[str] = None,
    driver: str = 'wia',
    dpi: int = 300,
    page_size: str = 'a4',
    bitdepth: str = 'color',
    source: Optional[str] = None,
    multipage: bool = True,
    deskew: bool = True,
    output_filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute scan using NAPS2 CLI and save output to temporary staging for preview without ingesting."""
    naps2 = find_naps2_executable()
    if not naps2:
        raise RuntimeError('NAPS2.Console.exe is not installed or not in PATH.')

    if source and source not in VALID_SOURCES:
        raise ValueError(f'Invalid source "{source}". Must be one of: {VALID_SOURCES}')

    if section not in VALID_SECTIONS:
        raise ValueError(f'Invalid section "{section}". Must be one of: {VALID_SECTIONS}')

    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    filename = output_filename or f'scan_{timestamp}_{section}.pdf'
    staging_output = STAGING_DIR / filename

    cmd = [
        naps2,
        '--driver', driver,
        '--dpi', str(dpi),
        '--pagesize', page_size,
        '--bitdepth', bitdepth,
        '-o', str(staging_output),
        '-f',  # force overwrite in staging if exists
    ]
    if device:
        cmd.extend(['--device', device])
    if source:
        cmd.extend(['--source', source])
    if deskew:
        cmd.append('--deskew')

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace'
    )
    if result.returncode != 0:
        raise RuntimeError(f'NAPS2 scan failed (exit code {result.returncode}): {result.stderr or result.stdout}')

    if not staging_output.exists() or staging_output.stat().st_size == 0:
        raise RuntimeError('Scanning completed but no output file was created.')

    sha256_hash = compute_file_hash(staging_output)

    # Count pages if PDF
    pages_count = 1
    try:
        content = staging_output.read_bytes()
        pages_count = max(1, len(re.findall(rb'/Type\s*/Page\b', content)))
    except Exception:
        pass

    return {
        'status': 'STAGED',
        'staging_path': str(staging_output),
        'filename': staging_output.name,
        'size_bytes': staging_output.stat().st_size,
        'sha256': sha256_hash,
        'pages_count': pages_count,
        'section': section,
    }


def scan_document(
    section: str,
    device: Optional[str] = None,
    driver: str = 'wia',
    dpi: int = 300,
    page_size: str = 'a4',
    bitdepth: str = 'color',
    source: Optional[str] = None,
    multipage: bool = True,
    deskew: bool = True,
    output_filename: Optional[str] = None,
    stage_only: bool = False,
) -> Dict[str, Any]:
    """Execute scan using NAPS2 CLI and pipe output into the ingestion pipeline or return staged result."""
    staged = scan_to_staging(
        section=section,
        device=device,
        driver=driver,
        dpi=dpi,
        page_size=page_size,
        bitdepth=bitdepth,
        source=source,
        multipage=multipage,
        deskew=deskew,
        output_filename=output_filename,
    )
    if stage_only:
        return staged

    # Ingest scanned output into target section
    return ingest_file(Path(staged['staging_path']), section=section)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list-devices', action='store_true', help='List connected scanners')
    parser.add_argument('--driver', default='wia', choices=['wia', 'twain', 'escl'], help='Scanner driver')
    parser.add_argument('--device', help='Scanner device name')
    parser.add_argument('--source', choices=VALID_SOURCES, help='Paper source (glass/feeder/duplex)')
    parser.add_argument('--scan', action='store_true', help='Trigger a scan')
    parser.add_argument('--import-file', type=Path, help='Manually import an existing PDF or image')
    parser.add_argument('--section', default='شخصي', choices=VALID_SECTIONS, help='Target department/section')
    parser.add_argument('--allow-duplicate', action='store_true', help='Allow re-importing duplicate documents')
    args = parser.parse_args()

    if args.list_devices:
        devices = list_scanning_devices(args.driver)
        print('Detected Scanning Devices:')
        for d, devs in devices.items():
            print(f'  Driver [{d}]:')
            for dev in devs:
                print(f'    - {dev}')
        return

    if args.import_file:
        res = ingest_file(args.import_file, section=args.section, allow_duplicate=args.allow_duplicate)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    if args.scan:
        res = scan_document(
            section=args.section,
            device=args.device,
            driver=args.driver,
            source=args.source
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    parser.print_help()


if __name__ == '__main__':
    main()
