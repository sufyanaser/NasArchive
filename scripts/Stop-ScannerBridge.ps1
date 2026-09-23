$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$RuntimeDir = Join-Path $ProjectRoot "runtime"
$PidFile = Join-Path $RuntimeDir "scanner_bridge.pid"

Write-Host "[*] Stopping NAS Archive Scanner Bridge..." -ForegroundColor Cyan

$stopped = $false

# 1. Kill process by PID file
if (Test-Path $PidFile) {
    $pidToKill = (Get-Content $PidFile -ErrorAction SilentlyContinue).Trim()
    if ($pidToKill -match '^\d+$') {
        $proc = Get-Process -Id [int]$pidToKill -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id [int]$pidToKill -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Stopped Scanner Bridge process (PID: $pidToKill)" -ForegroundColor Green
            $stopped = $true
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# 2. Kill any lingering process listening on port 8001
$portConns = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
if ($portConns) {
    foreach ($conn in $portConns) {
        $pId = $conn.OwningProcess
        if ($pId -gt 0) {
            Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Stopped process listening on port 8001 (PID: $pId)" -ForegroundColor Green
            $stopped = $true
        }
    }
}

Start-Sleep -Milliseconds 600

$remaining = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Warning "Port 8001 is still busy."
} else {
    Write-Host "[OK] NAS Archive Scanner Bridge is stopped. Port 8001 is free." -ForegroundColor Green
}
