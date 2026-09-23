$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DesktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$IconPath = Join-Path $ProjectRoot "assets\Dev-printer.ico"
$ExePath = Join-Path $ProjectRoot "dist\win-unpacked\NAS Archive.exe"

$Target = $ExePath
$Arguments = ""
if (-not (Test-Path $ExePath)) {
    $Target = "powershell.exe"
    $Arguments = "-WindowStyle Hidden -Command `"Set-Location '$ProjectRoot'; npx electron .`""
}

$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $DesktopDir "NAS Archive.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Target
if ($Arguments) { $Shortcut.Arguments = $Arguments }
$Shortcut.WorkingDirectory = $ProjectRoot
if (Test-Path $IconPath) {
    $Shortcut.IconLocation = "$IconPath,0"
}
$Shortcut.Description = "NAS Archive Desktop Application"
$Shortcut.Save()

$OldScanner = Join-Path $DesktopDir "NAS Archive - Scanner.url"
$OldPaperless = Join-Path $DesktopDir "NAS Archive - Paperless.url"
if (Test-Path $OldScanner) { Remove-Item $OldScanner -Force -ErrorAction SilentlyContinue }
if (Test-Path $OldPaperless) { Remove-Item $OldPaperless -Force -ErrorAction SilentlyContinue }

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "[OK] Standalone Desktop Shortcut created successfully:" -ForegroundColor Green
Write-Host "     Shortcut: $ShortcutPath" -ForegroundColor Cyan
Write-Host "     Target:   $Target" -ForegroundColor Gray
Write-Host "     Icon:     $IconPath" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
