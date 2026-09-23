$ErrorActionPreference = "Stop"
$DesktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)

# Shortcut 1: Scanner UI
$ScannerUrlPath = Join-Path $DesktopDir "NAS Archive - Scanner.url"
$ScannerContent = @"
[InternetShortcut]
URL=http://localhost:8001/
IconIndex=0
IconFile=C:\Windows\System32\shell32.dll,301
"@
Set-Content -Path $ScannerUrlPath -Value $ScannerContent -Encoding ascii

# Shortcut 2: Paperless Full Archive
$PaperlessUrlPath = Join-Path $DesktopDir "NAS Archive - Paperless.url"
$PaperlessContent = @"
[InternetShortcut]
URL=http://localhost:8000/
IconIndex=0
IconFile=C:\Windows\System32\shell32.dll,278
"@
Set-Content -Path $PaperlessUrlPath -Value $PaperlessContent -Encoding ascii

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "[OK] Desktop shortcuts created successfully:" -ForegroundColor Green
Write-Host "     1. $ScannerUrlPath" -ForegroundColor Cyan
Write-Host "     2. $PaperlessUrlPath" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
