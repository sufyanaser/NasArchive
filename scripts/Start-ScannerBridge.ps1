param(
    [switch]$OpenBrowser,
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$RuntimeDir = Join-Path $ProjectRoot "runtime"
$PidFile = Join-Path $RuntimeDir "scanner_bridge.pid"

if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
}

$BridgeUrl = "http://127.0.0.1:8001"
$StatusUrl = "$BridgeUrl/api/status"

function Test-BridgeHealth {
    try {
        $resp = Invoke-RestMethod -Uri $StatusUrl -Method Get -TimeoutSec 4 -ErrorAction Stop
        return ($resp.status -eq "HEALTHY")
    } catch {
        return $false
    }
}

# 1. Check if bridge is already running
if (Test-BridgeHealth) {
    Write-Host "[OK] NAS Archive Scanner Bridge is already running at $BridgeUrl" -ForegroundColor Green
    if ($OpenBrowser) {
        Start-Process $BridgeUrl
    }
    exit 0
}

# 2. Locate Python / Pythonw
$PythonExe = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\pythonw.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
}
if (-not $PythonExe -or -not (Test-Path $PythonExe)) {
    $PythonExe = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
}
if (-not (Test-Path $PythonExe)) {
    $PythonExe = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
}
if (-not $PythonExe -or -not (Test-Path $PythonExe)) {
    Write-Error "Python executable not found in PATH or standard location."
    exit 1
}

$BridgeScript = Join-Path $ScriptDir "scanner_bridge.py"

if ($Foreground) {
    Write-Host "[*] Starting Scanner Bridge in foreground..." -ForegroundColor Cyan
    $ConsolePython = $PythonExe -replace "pythonw\.exe$", "python.exe"
    & $ConsolePython $BridgeScript
    exit $LASTEXITCODE
}

Write-Host "[*] Starting NAS Archive Scanner Bridge in background..." -ForegroundColor Cyan

# Start hidden background process
$proc = Start-Process -FilePath $PythonExe -ArgumentList @($BridgeScript) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru

if ($proc) {
    $proc.Id | Out-File -FilePath $PidFile -Encoding utf8 -Force
}

# Poll for health check
$deadline = (Get-Date).AddSeconds(15)
$isHealthy = $false

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 600
    if (Test-BridgeHealth) {
        $isHealthy = $true
        break
    }
    if ($proc.HasExited) {
        Write-Error "Bridge process exited unexpectedly with code $($proc.ExitCode)."
        exit 1
    }
}

if ($isHealthy) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "[OK] NAS Archive Scanner Bridge started successfully!" -ForegroundColor Green
    Write-Host "     - UI Web: $BridgeUrl" -ForegroundColor Cyan
    Write-Host "     - Process PID: $($proc.Id)" -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Green

    if ($OpenBrowser) {
        Start-Process $BridgeUrl
    }
} else {
    Write-Error "Scanner Bridge failed to become healthy within timeout."
    exit 1
}
