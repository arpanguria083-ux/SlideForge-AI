param(
    [int]$Port = 8081
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$javaCmd = "java"
try {
    $null = & $javaCmd -version 2>&1
} catch {
    Write-Host "Java runtime not found in PATH." -ForegroundColor Yellow
    Write-Host "Install Java 17+ and ensure 'java' is available in PATH." -ForegroundColor Yellow
    Write-Host "LanguageTool server will not start without Java." -ForegroundColor Yellow
    exit 1
}

$candidateJars = @()

if ($env:LANGUAGETOOL_JAR) {
    $candidateJars += $env:LANGUAGETOOL_JAR
}

$candidateJars += @(
    (Join-Path $rootDir "backend\tools\LanguageTool\languagetool-server.jar"),
    (Join-Path $rootDir "backend\tools\languagetool\languagetool-server.jar")
)

$languageToolDirCandidates = @(
    (Join-Path $rootDir "backend\tools"),
    (Join-Path $rootDir "tools")
)

foreach ($baseDir in $languageToolDirCandidates) {
    if (Test-Path -LiteralPath $baseDir) {
        $foundJars = Get-ChildItem -LiteralPath $baseDir -Recurse -Filter "languagetool-server.jar" -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
        $candidateJars += $foundJars
    }
}

$jarPath = $candidateJars | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $jarPath) {
    Write-Host "LanguageTool server jar not found." -ForegroundColor Yellow
    Write-Host "Set LANGUAGETOOL_JAR or place languagetool-server.jar under backend\\tools." -ForegroundColor Yellow
    Write-Host "Expected engine URL: http://127.0.0.1:$Port" -ForegroundColor Cyan
    exit 1
}

$launchCmd = "Set-Location -LiteralPath '$([System.IO.Path]::GetDirectoryName($jarPath))'; & $javaCmd -jar '$jarPath' --port $Port --allow-origin '*'"

Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", $launchCmd | Out-Null

Write-Host "Started LanguageTool server in a separate PowerShell window." -ForegroundColor Green
Write-Host "Jar: $jarPath" -ForegroundColor Cyan
Write-Host "URL: http://127.0.0.1:$Port" -ForegroundColor Cyan
