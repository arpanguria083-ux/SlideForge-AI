param(
    [string]$FrontendUrl = "http://127.0.0.1:3000",
    [string]$BackendUrl = "http://127.0.0.1:8002",
    [string]$LanguageToolUrl = "http://127.0.0.1:8081"
)

$ErrorActionPreference = "Continue"

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Url,
        [string]$ExpectedContains = ""
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        $detail = "Reachable"
        if ($ExpectedContains -and -not ($response.Content -like "*$ExpectedContains*")) {
            return [pscustomobject]@{
                Name = $Name
                Url = $Url
                Status = "DEGRADED"
                StatusCode = $response.StatusCode
                Detail = "Unexpected response body"
            }
        }
        return [pscustomobject]@{
            Name = $Name
            Url = $Url
            Status = "UP"
            StatusCode = $response.StatusCode
            Detail = $detail
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        if ($statusCode) {
            return [pscustomobject]@{
                Name = $Name
                Url = $Url
                Status = "UP"
                StatusCode = $statusCode
                Detail = "Responded with HTTP $statusCode"
            }
        }

        return [pscustomobject]@{
            Name = $Name
            Url = $Url
            Status = "DOWN"
            StatusCode = "-"
            Detail = ($_.Exception.Message -replace "\r|\n", " ")
        }
    }
}

function Test-BackendHealth {
    param(
        [string]$Name,
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
        $status = "UP"
        $detail = "Reachable"

        try {
            $json = $response.Content | ConvertFrom-Json
            $apiStatus = ($json.status | ForEach-Object { "$_" })
            if ($apiStatus -and $apiStatus -eq "degraded") {
                $status = "DEGRADED"
                $detail = "Backend is reachable in degraded mode"
            } elseif ($apiStatus -and $apiStatus -ne "healthy") {
                $status = "DEGRADED"
                $detail = "Backend status: $apiStatus"
            }
        } catch {
            $status = "DEGRADED"
            $detail = "Backend health payload was not valid JSON"
        }

        return [pscustomobject]@{
            Name = $Name
            Url = $Url
            Status = $status
            StatusCode = $response.StatusCode
            Detail = $detail
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        if ($statusCode) {
            return [pscustomobject]@{
                Name = $Name
                Url = $Url
                Status = "DEGRADED"
                StatusCode = $statusCode
                Detail = "Responded with HTTP $statusCode"
            }
        }

        return [pscustomobject]@{
            Name = $Name
            Url = $Url
            Status = "DOWN"
            StatusCode = "-"
            Detail = ($_.Exception.Message -replace "\r|\n", " ")
        }
    }
}

$checks = @(
    (Test-Endpoint -Name "Frontend" -Url $FrontendUrl),
    (Test-BackendHealth -Name "Backend" -Url "$BackendUrl/api/health"),
    (Test-Endpoint -Name "LanguageTool" -Url $LanguageToolUrl)
)

$checks | Format-Table -AutoSize

$bad = $checks | Where-Object { $_.Status -eq "DOWN" }
if ($bad) {
    Write-Host ""
    Write-Host "One or more services are unavailable." -ForegroundColor Yellow
    exit 1
}

$degraded = $checks | Where-Object { $_.Status -eq "DEGRADED" }
if ($degraded) {
    Write-Host ""
    Write-Host "Services are reachable, but some are in degraded mode." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "All local services are reachable." -ForegroundColor Green
