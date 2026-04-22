$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Resolve-Path $scriptDir

Write-Host "Building React Frontend..." -ForegroundColor Cyan
Set-Location $repoRoot
npm run build

Write-Host "Copying Frontend to Backend Static folder..." -ForegroundColor Cyan
Set-Location $backendDir
if (Test-Path "static") {
    Remove-Item -Recurse -Force "static"
}
New-Item -ItemType Directory -Force -Path "static"
Copy-Item -Path (Join-Path $repoRoot "dist\*") -Destination "static" -Recurse

Write-Host "Installing PyInstaller..." -ForegroundColor Cyan
uv pip install pyinstaller

Write-Host "Building Python Executable..." -ForegroundColor Cyan
uv run pyinstaller SlideForge.spec --clean -y

Write-Host "Build complete! The packed folder is in backend\dist\SlideForge\" -ForegroundColor Green
Write-Host "Run backend\dist\SlideForge\SlideForge.exe to start the application." -ForegroundColor Yellow
