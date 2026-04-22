param(
    [switch]$IncludeLanguageTool
)

$ErrorActionPreference = "SilentlyContinue"

$stoppedIds = New-Object System.Collections.Generic.HashSet[int]

function Stop-ByProcessMatch {
    param(
        [string[]]$Patterns
    )

    $processes = Get-CimInstance Win32_Process | Where-Object {
        $cmd = $_.CommandLine
        if (-not $cmd) { return $false }
        foreach ($pattern in $Patterns) {
            if ($cmd -like "*$pattern*") { return $true }
        }
        return $false
    }

    foreach ($proc in $processes) {
        if ($stoppedIds.Add([int]$proc.ProcessId)) {
            Stop-Process -Id $proc.ProcessId -Force
        }
    }
}

function Stop-ByPort {
    param(
        [int[]]$Ports
    )

    foreach ($port in $Ports) {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $connections) {
            if ($stoppedIds.Add([int]$conn.OwningProcess)) {
                Stop-Process -Id $conn.OwningProcess -Force
            }
        }
    }
}

Stop-ByProcessMatch -Patterns @(
    "uvicorn app.main:app",
    "npm run dev -- --host 127.0.0.1 --port 3000",
    "vite --host 127.0.0.1 --port 3000"
)
Stop-ByPort -Ports @(8002, 3000)

if ($IncludeLanguageTool) {
    $languageToolScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "stop-languagetool.ps1"
    if (Test-Path -LiteralPath $languageToolScript) {
        & $languageToolScript
    } else {
        Stop-ByProcessMatch -Patterns @("languagetool-server.jar", "--port 8081 --allow-origin")
        Stop-ByPort -Ports @(8081)
    }
}

if ($stoppedIds.Count -gt 0) {
    Write-Host "Stopped local stack process(es): $($stoppedIds -join ', ')" -ForegroundColor Green
} else {
    Write-Host "No running backend/frontend processes found on ports 8002 or 3000." -ForegroundColor Yellow
}
