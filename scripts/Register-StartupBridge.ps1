param(
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$StartupFolder = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup)
$ShortcutPath = Join-Path $StartupFolder "NAS-Archive-ScannerBridge.lnk"

if ($Unregister) {
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "[OK] Startup shortcut removed successfully." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Startup shortcut not found." -ForegroundColor Yellow
    }
    exit 0
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$StartScript = Join-Path $ScriptDir "Start-ScannerBridge.ps1"
$Shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "Auto-start NAS Archive Local Scanner Bridge"
$Shortcut.Save()

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "[OK] Scanner Bridge registered to auto-start on Windows logon!" -ForegroundColor Green
Write-Host "     - Path: $ShortcutPath" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
