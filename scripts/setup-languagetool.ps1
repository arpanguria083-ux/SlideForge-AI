param(
    [string]$Version = "6.5",
    [int]$Port = 8081
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$targetDir = Join-Path $rootDir "backend\tools\languagetool"
$tempDir = Join-Path $rootDir "backend\tools\_tmp"
$zipPath = Join-Path $tempDir "LanguageTool-$Version.zip"
$downloadUrl = "https://languagetool.org/download/LanguageTool-$Version.zip"

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "Downloading LanguageTool $Version from $downloadUrl" -ForegroundColor Cyan
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

Write-Host "Extracting archive..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

$jarCandidate = Get-ChildItem -Path $tempDir -Recurse -Filter "languagetool-server.jar" |
    Select-Object -First 1

if (-not $jarCandidate) {
    throw "languagetool-server.jar was not found in extracted archive."
}

$finalJar = Join-Path $targetDir "languagetool-server.jar"
Copy-Item -LiteralPath $jarCandidate.FullName -Destination $finalJar -Force

Write-Host "LanguageTool server jar installed: $finalJar" -ForegroundColor Green
Write-Host "Starting LanguageTool on port $Port..." -ForegroundColor Cyan

powershell.exe -ExecutionPolicy Bypass -File (Join-Path $rootDir "start-languagetool.ps1") -Port $Port
