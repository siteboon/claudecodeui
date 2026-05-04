# BnM Claude CLI — Stack Startup Script (Windows)
# Starts all 4 services: 9Router, CrewAI Bridge, CloudCLI UI
# Usage: .\start-stack.ps1

$ErrorActionPreference = "Continue"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROUTER_DIR = "C:\Dev\tools\9router"
$CREWAI_DIR = "C:\Dev\tools\CrewAI-Studio"
$CLOUDCLI_DIR = $ROOT

function Wait-ForHealth {
    param([string]$Url, [string]$Name, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  [OK] $Name is healthy" -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    Write-Host "  [FAIL] $Name did not respond within $TimeoutSeconds seconds" -ForegroundColor Red
    return $false
}

Write-Host ""
Write-Host "=== BnM Claude CLI Stack ===" -ForegroundColor Cyan
Write-Host ""

# 1. Start 9Router
if (Test-Path "$ROUTER_DIR\package.json") {
    Write-Host "[1/3] Starting 9Router (:20128)..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $ROUTER_DIR -WindowStyle Minimized
    Wait-ForHealth "http://localhost:20128" "9Router"
} else {
    Write-Host "[1/3] 9Router directory not found at $ROUTER_DIR — skipping" -ForegroundColor DarkYellow
}

# 2. Start CrewAI FastAPI Bridge
if (Test-Path "$CREWAI_DIR\bridge\api.py") {
    Write-Host "[2/3] Starting CrewAI Bridge (:8000)..." -ForegroundColor Yellow
    $venvPython = Join-Path $CREWAI_DIR "venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        Start-Process -FilePath $venvPython -ArgumentList "bridge\api.py" -WorkingDirectory $CREWAI_DIR -WindowStyle Minimized
    } else {
        Start-Process -FilePath "python" -ArgumentList "bridge\api.py" -WorkingDirectory $CREWAI_DIR -WindowStyle Minimized
    }
    Wait-ForHealth "http://localhost:8000/health" "CrewAI Bridge"
} else {
    Write-Host "[2/3] CrewAI bridge not found at $CREWAI_DIR\bridge\api.py — skipping" -ForegroundColor DarkYellow
}

# 3. Start CloudCLI UI
Write-Host "[3/3] Starting CloudCLI UI (:3001)..." -ForegroundColor Yellow
Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $CLOUDCLI_DIR -WindowStyle Minimized
Wait-ForHealth "http://localhost:3001/api/health" "CloudCLI UI"

Write-Host ""
Write-Host "=== Stack Ready ===" -ForegroundColor Green
Write-Host "  CloudCLI UI:   http://localhost:3001"
Write-Host "  9Router:       http://localhost:20128"
Write-Host "  CrewAI Bridge: http://localhost:8000"
Write-Host ""
