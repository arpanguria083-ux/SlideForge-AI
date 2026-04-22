param(
    [int]$Port = 8081
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
        [int]$LocalPort
    )

    $connections = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($stoppedIds.Add([int]$conn.OwningProcess)) {
            Stop-Process -Id $conn.OwningProcess -Force
        }
    }
}

Stop-ByProcessMatch -Patterns @("languagetool-server.jar", "--port $Port --allow-origin")
Stop-ByPort -LocalPort $Port

if ($stoppedIds.Count -gt 0) {
    Write-Host "Stopped LanguageTool process(es): $($stoppedIds -join ', ')" -ForegroundColor Green
} else {
    Write-Host "No running LanguageTool process found on port $Port." -ForegroundColor Yellow
}
