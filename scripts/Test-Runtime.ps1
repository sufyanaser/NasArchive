$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $dockerBin = 'C:\Program Files\Docker\Docker\resources\bin'
    if (Test-Path (Join-Path $dockerBin 'docker.exe')) {
        $env:PATH = "$dockerBin;$env:PATH"
    } else {
        throw 'Docker CLI is missing. Install Docker Desktop with the WSL 2 Linux-container backend, then rerun.'
    }
}
$engineType = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is unavailable.' }
if ("$engineType".Trim() -ne 'linux') { throw 'Docker must use Linux containers.' }
docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed.' }
docker compose up -d --wait --wait-timeout 300
if ($LASTEXITCODE -ne 0) { throw 'Services did not become ready.' }
$languages = docker compose exec -T webserver tesseract --list-langs 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect OCR languages.' }
foreach ($lang in @('ara', 'eng')) {
    if (-not ($languages | Where-Object { "$_".Trim() -eq $lang })) { throw "Missing OCR language: $lang" }
}
$response = Invoke-WebRequest 'http://localhost:8000/accounts/login/' -UseBasicParsing
if ($response.StatusCode -ne 200) { throw 'Login page is unavailable.' }
Write-Output 'PASS: services started, Arabic/English Tesseract data available, login page returned HTTP 200.'
Write-Output 'This smoke check does not evaluate ingestion, OCR accuracy or backup restoration; run the separate acceptance checks.'
