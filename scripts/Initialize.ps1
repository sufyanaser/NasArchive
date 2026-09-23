$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    function New-Secret {
        $bytes = New-Object byte[] 48
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        return [Convert]::ToBase64String($bytes)
    }
    $settings = "POSTGRES_PASSWORD=$(New-Secret)`nPAPERLESS_SECRET_KEY=$(New-Secret)`n"
    [System.IO.File]::WriteAllText($envPath, $settings, (New-Object System.Text.UTF8Encoding($false)))
}
$schema = Get-Content (Join-Path $repoRoot 'config/catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($tag in $schema.tags | Where-Object { -not $_.is_inbox_tag }) {
    New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot "runtime/consume/$($tag.name)") | Out-Null
}
foreach ($dir in @('runtime/staging', 'runtime/export')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot $dir) | Out-Null
}
Write-Output 'Local secrets and scanner folders are ready. Existing secrets were preserved.'
