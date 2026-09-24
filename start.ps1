<#
.SYNOPSIS
    Starts the Goal Guru development server.

.DESCRIPTION
    Checks prerequisites (Node.js and npm), verifies dependencies,
    ensures the local SQLite data directory exists, and starts the
    Goal Guru Fastify development server with live TypeScript reload (tsx watch).

.PARAMETER Open
    Opens Goal Guru in your default web browser upon launch.

.PARAMETER Port
    Specifies a custom port to run the server on (default: 3000).

.PARAMETER WithTests
    Launches Vitest test runner in watch mode in a separate console window.

.EXAMPLE
    .\start.ps1
    Starts the dev server at http://localhost:3000.

.EXAMPLE
    .\start.ps1 -Open
    Starts the dev server and automatically opens http://localhost:3000 in your browser.

.EXAMPLE
    .\start.ps1 -Port 3001 -Open -WithTests
    Starts the server on port 3001, opens the browser, and spawns the test watcher.
#>

[CmdletBinding()]
param(
    [Alias("o")]
    [switch]$Open,

    [Alias("p")]
    [int]$Port = 3000,

    [Alias("t")]
    [switch]$WithTests
)

$ErrorActionPreference = "Stop"

# Ensure we run from the project root directory
Set-Location -Path $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      Goal Guru - Startup Script          " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Verify Node.js and npm are available
Write-Host "`n[1/4] Checking prerequisites..." -ForegroundColor Yellow
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed or not in your PATH. Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
}

$nodeVersion = & node -v
Write-Host " -> Node.js version: $nodeVersion" -ForegroundColor Green

if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Error "npm is not installed or not in your PATH."
    exit 1
}

# 2. Check dependencies (node_modules)
Write-Host "`n[2/4] Checking dependencies..." -ForegroundColor Yellow
if (-not (Test-Path -Path "node_modules")) {
    Write-Host " -> 'node_modules' not found. Installing dependencies via npm install..." -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install dependencies. Please inspect npm error output above."
        exit $LASTEXITCODE
    }
    Write-Host " -> Dependencies installed successfully." -ForegroundColor Green
} else {
    Write-Host " -> Dependencies already installed." -ForegroundColor Green
}

# 3. Ensure data storage directory exists
Write-Host "`n[3/4] Checking SQLite data directory..." -ForegroundColor Yellow
$dataDir = Join-Path $PSScriptRoot "data"
if (-not (Test-Path -Path $dataDir)) {
    Write-Host " -> Creating '$dataDir' directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host " -> Data directory created." -ForegroundColor Green
} else {
    Write-Host " -> Data directory ready ($dataDir)." -ForegroundColor Green
}

# 4. Optional: Launch test watcher in a separate window
if ($WithTests) {
    Write-Host "`n[+] Spawning Vitest watcher in a separate window..." -ForegroundColor Magenta
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot'; Write-Host 'Goal Guru Test Watcher' -ForegroundColor Cyan; npm run test:watch"
}

# 5. Launch server
Write-Host "`n[4/4] Launching Goal Guru dev server..." -ForegroundColor Yellow
$serverUrl = "http://localhost:$Port"
Write-Host " -> Access URL: $serverUrl" -ForegroundColor Green
Write-Host " -> Mode: Live reload (tsx watch)`n" -ForegroundColor Cyan

# Set PORT environment variable for the server process
$env:PORT = "$Port"

if ($Open) {
    # Open default browser after brief delay to allow server initialization
    Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Milliseconds 1200
        Start-Process $url
    } -ArgumentList $serverUrl | Out-Null
}

# Execute development server
& npx tsx watch src/server/server.ts
