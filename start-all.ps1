param(
    [switch]$WithLanguageTool
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $rootDir "backend"
$frontendDir = $rootDir

if (-not (Test-Path -LiteralPath $backendDir)) {
    throw "Backend folder not found: $backendDir"
}

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "Frontend folder not found: $frontendDir"
}

$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $backendPython) {
    $backendCmd = "& '$backendPython' -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload"
} else {
    $backendCmd = "python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload"
}

$frontendCmd = "npm run dev -- --host 127.0.0.1 --port 3000"

$backendDataDir = Join-Path $backendDir "data"
$backendTmpDir = Join-Path $backendDataDir "tmp"
$backendCacheDir = Join-Path $backendDataDir "surya_models"

$backendLaunch = @"
Set-Location -LiteralPath '$backendDir'
`$env:MODEL_CACHE_DIR = '$backendCacheDir'
`$env:TMPDIR = '$backendTmpDir'
`$env:TEMP = '$backendTmpDir'
`$env:TMP = '$backendTmpDir'
$backendCmd
"@
$frontendLaunch = "Set-Location -LiteralPath '$frontendDir'; $frontendCmd"

Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $backendLaunch | Out-Null
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $frontendLaunch | Out-Null

if ($WithLanguageTool) {
    $languageToolScript = Join-Path $rootDir "start-languagetool.ps1"
    if (Test-Path -LiteralPath $languageToolScript) {
        Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy", "Bypass", "-File", $languageToolScript | Out-Null
    }
}

Write-Host "Started backend and frontend in separate PowerShell windows." -ForegroundColor Green
Write-Host "Frontend: http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://127.0.0.1:8002" -ForegroundColor Cyan
if ($WithLanguageTool) {
    Write-Host "Grammar:  http://127.0.0.1:8081" -ForegroundColor Cyan
}

$healthScript = Join-Path $rootDir "health-check.ps1"
if (Test-Path -LiteralPath $healthScript) {
    Write-Host "Waiting for local services to boot..." -ForegroundColor Yellow
    Start-Sleep -Seconds 4
    & $healthScript
}
