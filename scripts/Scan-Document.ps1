[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Section = 'شخصي',

    [Parameter(Mandatory=$false)]
    [string]$Device,

    [Parameter(Mandatory=$false)]
    [string]$Driver = 'wia',

    [Parameter(Mandatory=$false)]
    [string]$ImportFile,

    [Parameter(Mandatory=$false)]
    [switch]$ListDevices,

    [Parameter(Mandatory=$false)]
    [switch]$AllowDuplicate
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $python) {
    throw 'Python 3 is required.'
}

$scriptPath = Join-Path $PSScriptRoot 'scanner_ingest.py'

if ($ListDevices) {
    & $python $scriptPath --list-devices --driver $Driver
    exit $LASTEXITCODE
}

if ($ImportFile) {
    $resolvedPath = Resolve-Path $ImportFile
    $argsList = @($scriptPath, '--import-file', $resolvedPath.Path, '--section', $Section)
    if ($AllowDuplicate) { $argsList += '--allow-duplicate' }
    & $python @argsList
    exit $LASTEXITCODE
}

$scanArgs = @($scriptPath, '--scan', '--section', $Section, '--driver', $Driver)
if ($Device) { $scanArgs += @('--device', $Device) }
if ($AllowDuplicate) { $scanArgs += '--allow-duplicate' }

Write-Host "Initiating scan for section [$Section] using driver [$Driver]..." -ForegroundColor Cyan
& $python @scanArgs
exit $LASTEXITCODE
