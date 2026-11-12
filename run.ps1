# Plain $args, not a [Parameter()] param block: that makes this an advanced script, and PowerShell's
# common parameters then swallow the short flags (-w -> -WarningAction/-WarningVariable, -d -> -Debug).
$CliArgs = @($args)

# ---- Usage ----
function Show-Usage {
@"
Usage: .\run.ps1 [OPTIONS]

Options:
  -b, --backend        Run .NET API
  -w, --worker         Run .NET Worker
  -a, --all            Build frontend + run API + Worker
  -f, --frontend       Run frontend (npm run dev)

  -n, --npm <args>     Run npm command (client/)
  -d, --dotnet <args>  Run dotnet CLI command

  -k, --kill-port      Kill process on API port
  -h, --help           Show this help

Tests:
  -tf, --test-fe       Frontend unit tests (client/: build + vitest)
  -te, --test-e2e      End-to-end tests (e2e/: playwright)
  -tb, --test-be       Backend unit tests (server/: clean + build + dotnet test)
  -ta, --test-all      Frontend unit + backend unit + e2e

Env:
  SKIP_BUILD=1         Skip the client build step in --test-fe
"@ | Write-Host
}

# ---- Flags ----
$Backend = $false
$Worker = $false
$All = $false
$Frontend = $false
$KillPort = $false
$TestFe = $false
$TestE2e = $false
$TestBe = $false
$TestAll = $false
$Npm = @()
$Dotnet = @()

# ---- Parse args ----
$i = 0
while ($i -lt $CliArgs.Count) {
    switch ($CliArgs[$i]) {

        "-b" { $Backend = $true }
        "--backend" { $Backend = $true }

        "-w" { $Worker = $true }
        "--worker" { $Worker = $true }

        "-a" { $All = $true }
        "--all" { $All = $true }

        "-f" { $Frontend = $true }
        "--frontend" { $Frontend = $true }

        "-k" { $KillPort = $true }
        "--kill-port" { $KillPort = $true }

        "-tf" { $TestFe = $true }
        "--test-fe" { $TestFe = $true }

        "-te" { $TestE2e = $true }
        "--test-e2e" { $TestE2e = $true }

        "-tb" { $TestBe = $true }
        "--test-be" { $TestBe = $true }

        "-ta" { $TestAll = $true }
        "--test-all" { $TestAll = $true }

        "-h" { Show-Usage; exit }
        "--help" { Show-Usage; exit }

        "-n" { $i++; while ($i -lt $CliArgs.Count -and $CliArgs[$i] -notmatch "^-") { $Npm += $CliArgs[$i]; $i++ }; $i-- }
        "--npm" { $i++; while ($i -lt $CliArgs.Count -and $CliArgs[$i] -notmatch "^-") { $Npm += $CliArgs[$i]; $i++ }; $i-- }

        "-d" { $i++; while ($i -lt $CliArgs.Count -and $CliArgs[$i] -notmatch "^-") { $Dotnet += $CliArgs[$i]; $i++ }; $i-- }
        "--dotnet" { $i++; while ($i -lt $CliArgs.Count -and $CliArgs[$i] -notmatch "^-") { $Dotnet += $CliArgs[$i]; $i++ }; $i-- }

        default {
            Write-Host "Unknown option: $($CliArgs[$i])"
            Show-Usage
            exit 1
        }
    }
    $i++
}

if (-not ($Backend -or $Worker -or $All -or $Frontend -or $KillPort -or $TestFe -or $TestE2e -or $TestBe -or $TestAll -or $Npm.Count -or $Dotnet.Count)) {
    Show-Usage
    exit
}

# ---- Paths ----
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClientDir = Join-Path $ScriptDir "client"
$E2eDir = Join-Path $ScriptDir "e2e"
$ApiProject = Join-Path $ScriptDir "server/Api/Api.csproj"
$WorkerProject = Join-Path $ScriptDir "server/Worker/Worker.csproj"
$Wwwroot = Join-Path $ScriptDir "server/Api/wwwroot"
$Solution = Join-Path $ScriptDir "server/Blocks.slnx"

$ApiPort = 5001
# Host the local API is reached by. It resolves to 127.0.0.1 via the hosts file and matches the
# dev TLS cert, so it is also the origin the served frontend must call.
$ApiHost = "dev-monitor.blocksdevelopers.com"

# ---- Helpers ----

function Free-Port {
    $connections = netstat -ano | Select-String ":$ApiPort"
    foreach ($line in $connections) {
        $parts = ($line -split "\s+") | Where-Object { $_ }
        # Not $pid: that is a read-only automatic variable and assigning to it throws.
        $procId = $parts[-1]
        if ($procId -match "^\d+$") {
            Write-Host "Killing PID $procId on port $ApiPort"
            taskkill /PID $procId /F | Out-Null
        }
    }
}

function Restore-Dotnet {
    Write-Host "Restoring .NET dependencies..."
    dotnet restore $ApiProject
    dotnet restore $WorkerProject
}

function Build-Frontend {
    Write-Host "Building frontend..."
    npm --prefix $ClientDir install
    npm --prefix $ClientDir run build

    if (!(Test-Path $Wwwroot)) {
        New-Item -ItemType Directory -Path $Wwwroot | Out-Null
    }

    if (Test-Path "$ClientDir/dist") {
        Write-Host "Syncing dist → wwwroot..."
        robocopy "$ClientDir/dist" $Wwwroot /MIR | Out-Null
    }
}

# HTTPS is driven by the machine env vars MONITOR_SSL_CERT / MONITOR_SSL_KEY.
# Both set + both files present -> HTTPS on $ApiPort; otherwise -> HTTP (fallback).
# Sets the Kestrel cert env vars (inherited by child Start-Process) and stores
# the URL in $script:AspNetCoreUrls to pass on the command line.
function Set-BackendTls {
    $cert = $env:MONITOR_SSL_CERT
    $key  = $env:MONITOR_SSL_KEY
    if ($cert -and $key -and (Test-Path $cert) -and (Test-Path $key)) {
        $env:Kestrel__Certificates__Default__Path = $cert
        $env:Kestrel__Certificates__Default__KeyPath = $key
        $script:AspNetCoreUrls = "https://0.0.0.0:$ApiPort"
        Write-Host "Backend TLS: HTTPS on $ApiPort"
    }
    else {
        $script:AspNetCoreUrls = "http://0.0.0.0:$ApiPort"
        Write-Host "Backend TLS: cert env not set/found - HTTP on $ApiPort"
    }
}

# The FrontendRuntime values Program.cs bakes into wwwroot come from the Mongo "Secrets"
# document, which stores the *deployed* origin - https://dev-monitor.blocksdevelopers.com, with no
# port. Served locally that sends the OIDC callback to :443, where nothing listens. Env vars named
# "FrontendRuntime__<key>" override the Mongo section, so pin the Monitor origin to the port this
# script binds. Call it after Set-BackendTls: the scheme has to match the one chosen there.
function Set-FrontendRuntime {
    $scheme = if ($script:AspNetCoreUrls -like "https://*") { "https" } else { "http" }
    $origin = "${scheme}://${ApiHost}:$ApiPort"

    # A caller's value wins (e2e/playwright.config.ts passes E2E_BASE_URL this way).
    if (-not $env:FrontendRuntime__BLOCKS_MONITOR_BASE_URL) {
        $env:FrontendRuntime__BLOCKS_MONITOR_BASE_URL = $origin
    }
    if (-not $env:FrontendRuntime__BLOCKS_MONITOR_CALLBACK_URL) {
        $env:FrontendRuntime__BLOCKS_MONITOR_CALLBACK_URL = $env:FrontendRuntime__BLOCKS_MONITOR_BASE_URL.TrimEnd('/') + "/login/callback"
    }

    Write-Host "Frontend runtime: BLOCKS_MONITOR_BASE_URL = $($env:FrontendRuntime__BLOCKS_MONITOR_BASE_URL)"
}

function Run-Backend {
    Set-BackendTls
    Set-FrontendRuntime
    Write-Host "Running .NET API on $($script:AspNetCoreUrls)..."
    # --urls on the command line outranks launchSettings.json applicationUrl.
    dotnet run --project $ApiProject -- --urls $script:AspNetCoreUrls
}

function Run-Worker {
    Write-Host "Running .NET Worker..."
    dotnet run --project $WorkerProject
}

# ---- Tests ----

function Confirm-NodeModules {
    param([string]$Dir)
    if (!(Test-Path (Join-Path $Dir "node_modules"))) {
        Write-Host "Installing dependencies in $(Split-Path -Leaf $Dir)..."
        npm --prefix $Dir clean-install
    }
}

# Vitest does not read dist/, so the build is only a TypeScript gate.
# Skip it with SKIP_BUILD=1 for a faster loop.
function Test-Frontend {
    Write-Host "=== Frontend unit tests ==="

    Confirm-NodeModules $ClientDir

    if ($env:SKIP_BUILD -eq "1") {
        Write-Host "SKIP_BUILD=1 - skipping client build."
    }
    else {
        npm --prefix $ClientDir run build
    }

    npm --prefix $ClientDir run test
}

# Playwright starts the app itself (webServer: run.sh -b) and needs e2e/.env.e2e.
function Test-E2e {
    Write-Host "=== E2E tests ==="

    if (!(Test-Path (Join-Path $E2eDir ".env.e2e"))) {
        Write-Host "Missing $E2eDir\.env.e2e - copy .env.e2e.example and set E2E_BASE_URL + credentials."
        exit 1
    }

    Confirm-NodeModules $E2eDir

    npm --prefix $E2eDir exec -- playwright install --no-shell chromium
    npm --prefix $E2eDir run test
}

function Test-Backend {
    Write-Host "=== Backend unit tests ==="

    dotnet clean $Solution
    dotnet build $Solution
    dotnet test $Solution --no-build
}

function Test-All {
    Test-Frontend
    Test-Backend
    Test-E2e
}

# ---- Execution ----

if ($KillPort) {
    Free-Port
    exit
}

if ($Dotnet.Count -gt 0) {
    dotnet @Dotnet
    exit
}

if ($Npm.Count -gt 0) {
    npm --prefix $ClientDir @Npm
    exit
}

if ($TestFe) {
    Test-Frontend
    exit
}

if ($TestE2e) {
    Test-E2e
    exit
}

if ($TestBe) {
    Test-Backend
    exit
}

if ($TestAll) {
    Test-All
    exit
}

if ($Backend) {
    Free-Port
    Restore-Dotnet
    Run-Backend
    exit
}

if ($Worker) {
    Restore-Dotnet
    Run-Worker
    exit
}

if ($Frontend) {
    npm --prefix $ClientDir install
    npm --prefix $ClientDir run dev
    exit
}

if ($All) {
    Free-Port
    Restore-Dotnet
    Build-Frontend

    # Resolve TLS in this (parent) process: the Kestrel__* env vars it sets are
    # inherited by the child Start-Process; the URL is passed on its command line.
    Set-BackendTls
    Set-FrontendRuntime

    Write-Host "Starting API + Worker..."

    $api = Start-Process powershell `
        -ArgumentList "-NoExit", "-Command", "dotnet run --project '$ApiProject' -- --urls '$script:AspNetCoreUrls'" `
        -PassThru

    $worker = Start-Process powershell `
        -ArgumentList "-NoExit", "-Command", "dotnet run --project '$WorkerProject'" `
        -PassThru

    Write-Host "API PID: $($api.Id)"
    Write-Host "Worker PID: $($worker.Id)"
    Write-Host "Press Enter to stop..."

    [void][Console]::ReadLine()

    try { Stop-Process $api.Id -Force } catch {}
    try { Stop-Process $worker.Id -Force } catch {}
}
