<#
.SYNOPSIS
    Starts all three FarmLink AI services, each in its own PowerShell window.

.DESCRIPTION
    Checks that dependencies and trained models are in place (installing or
    training anything missing), launches the ML service, backend and frontend,
    waits until each one answers, then opens the app in your browser.

.PARAMETER Stop
    Shuts down everything this script started.

.PARAMETER SkipMl
    Don't start the Flask ML service. The app still runs; the AI Insights and
    price-suggestion panels show an offline notice instead.

.PARAMETER NoBrowser
    Don't open the browser once the frontend is ready.

.EXAMPLE
    .\start-all.ps1
    .\start-all.ps1 -SkipMl
    .\start-all.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$SkipMl,
    [switch]$NoBrowser
)

$root     = $PSScriptRoot
$mlDir    = Join-Path $root 'ml-service'
$beDir    = Join-Path $root 'backend'
$feDir    = Join-Path $root 'frontend'
$pidFile  = Join-Path $root '.farmlink-pids.json'

function Write-Head($text) { Write-Host "`n$text" -ForegroundColor White }
function Write-Ok($text)   { Write-Host "  [ok]   $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "  [..]   $text" -ForegroundColor Cyan }
function Write-Warn($text) { Write-Host "  [warn] $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "  [fail] $text" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Stop mode
# ---------------------------------------------------------------------------
if ($Stop) {
    Write-Head 'Stopping FarmLink AI services'

    $stopped = 0

    if (Test-Path $pidFile) {
        $saved = Get-Content $pidFile -Raw | ConvertFrom-Json

        foreach ($entry in $saved) {
            $running = Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue
            if ($running) {
                # /T kills the whole tree, so the node/python child goes too.
                & taskkill.exe /PID $entry.Pid /T /F | Out-Null
                Write-Ok "stopped $($entry.Name) (pid $($entry.Pid))"
                $stopped++
            }
        }

        Remove-Item $pidFile -Force
    }

    # Catch anything left behind from an earlier run or a manual start.
    $escaped = [regex]::Escape($root)
    $strays = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='python.exe'" |
              Where-Object { $_.CommandLine -and $_.CommandLine -match $escaped }

    foreach ($stray in $strays) {
        & taskkill.exe /PID $stray.ProcessId /T /F | Out-Null
        Write-Ok "stopped stray $($stray.Name) (pid $($stray.ProcessId))"
        $stopped++
    }

    if ($stopped -eq 0) {
        Write-Info 'nothing was running'
    }

    Write-Host ''
    return
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
Write-Head 'FarmLink AI - preflight'

foreach ($dir in @($mlDir, $beDir, $feDir)) {
    if (-not (Test-Path $dir)) {
        Write-Fail "missing folder: $dir"
        Write-Host '  Run this script from the project root.' -ForegroundColor Red
        return
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail 'node is not on your PATH - install Node.js first'
    return
}
Write-Ok "node $(node --version)"

$pythonOk = [bool](Get-Command python -ErrorAction SilentlyContinue)
if ($pythonOk) {
    Write-Ok (python --version 2>&1)
} else {
    if (-not $SkipMl) {
        Write-Warn 'python not found - starting without the ML service'
        $SkipMl = $true
    }
}

# backend .env
$envFile = Join-Path $beDir '.env'
if (-not (Test-Path $envFile)) {
    Write-Fail 'backend\.env is missing'
    Write-Host '  Create it with:' -ForegroundColor Red
    Write-Host '    PORT=5000' -ForegroundColor DarkGray
    Write-Host '    MONGO_URI=<your mongodb connection string>' -ForegroundColor DarkGray
    Write-Host '    JWT_SECRET=<any long random string>' -ForegroundColor DarkGray
    return
}
Write-Ok 'backend\.env found'

# node dependencies
foreach ($pair in @(@{ Name = 'backend'; Path = $beDir }, @{ Name = 'frontend'; Path = $feDir })) {
    if (-not (Test-Path (Join-Path $pair.Path 'node_modules'))) {
        Write-Info "installing $($pair.Name) dependencies (first run, this takes a minute)"
        Push-Location $pair.Path
        npm install --no-audit --no-fund
        $installOk = $?
        Pop-Location
        if (-not $installOk) {
            Write-Fail "npm install failed in $($pair.Name)"
            return
        }
    }
    Write-Ok "$($pair.Name) dependencies ready"
}

# trained ML models
if (-not $SkipMl) {
    $priceModel  = Join-Path $mlDir 'price_model.pkl'
    $demandModel = Join-Path $mlDir 'demand_model.pkl'
    $demandCtx   = Join-Path $mlDir 'demand_context.json'

    if (-not (Test-Path $priceModel)) {
        Write-Info 'training the price model'
        Push-Location $mlDir
        python train_model.py
        Pop-Location
    }

    if ((-not (Test-Path $demandModel)) -or (-not (Test-Path $demandCtx))) {
        Write-Info 'training the demand model (one-off, ~15s)'
        Push-Location $mlDir
        python generate_demand_data.py
        python train_demand_model.py
        Pop-Location
    }

    if (Test-Path $demandModel) {
        Write-Ok 'ML models ready'
    } else {
        Write-Warn 'demand model could not be trained - starting without the ML service'
        $SkipMl = $true
    }
}

# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------
Write-Head 'Starting services'

$launched = @()

function Start-Service2($name, $workingDir, $command, $color) {
    $inner = "`$host.UI.RawUI.WindowTitle = 'FarmLink - $name'; " +
             "Write-Host 'FarmLink AI - $name' -ForegroundColor $color; " +
             "Write-Host 'Close this window or run .\start-all.ps1 -Stop to shut down.' -ForegroundColor DarkGray; " +
             "Write-Host ''; " +
             "Set-Location -LiteralPath '$workingDir'; " +
             $command

    $proc = Start-Process -FilePath 'powershell.exe' `
                          -ArgumentList @('-NoExit', '-NoProfile', '-Command', $inner) `
                          -WorkingDirectory $workingDir `
                          -PassThru

    Write-Ok "$name launching (window pid $($proc.Id))"
    return $proc.Id
}

function Wait-ForUrl($name, $url, $timeoutSeconds = 45) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null
            Write-Ok "$name is up  ->  $url"
            return $true
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }

    Write-Warn "$name did not answer within ${timeoutSeconds}s - check its window"
    return $false
}

if (-not $SkipMl) {
    $mlPid = Start-Service2 'ML service' $mlDir 'python app.py' 'Magenta'
    $launched += @{ Name = 'ML service'; Pid = $mlPid }
}

$bePid = Start-Service2 'Backend API' $beDir 'npm start' 'Cyan'
$launched += @{ Name = 'Backend API'; Pid = $bePid }

# Give the API a head start so the first dashboard load has something to hit.
if (-not $SkipMl) { Wait-ForUrl 'ML service' 'http://localhost:8000/' 60 | Out-Null }
$backendUp = Wait-ForUrl 'Backend API' 'http://localhost:5000/' 45

$fePid = Start-Service2 'Frontend' $feDir 'npm run dev' 'Green'
$launched += @{ Name = 'Frontend'; Pid = $fePid }

$frontendUp = Wait-ForUrl 'Frontend' 'http://localhost:5173/' 60

$launched | ConvertTo-Json | Set-Content -Path $pidFile -Encoding utf8

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Head 'FarmLink AI is running'
if (-not $SkipMl) {
    Write-Host '  ML service   http://localhost:8000' -ForegroundColor DarkGray
}
Write-Host '  Backend API  http://localhost:5000' -ForegroundColor DarkGray
Write-Host '  App          http://localhost:5173' -ForegroundColor White

if ($backendUp) {
    try {
        $health = Invoke-RestMethod -Uri 'http://localhost:5000/' -TimeoutSec 3
        if ($health.database -eq 'connected') {
            Write-Ok 'MongoDB connected'
        } else {
            Write-Warn 'MongoDB is NOT connected - check MONGO_URI in backend\.env'
        }
    } catch {
        Write-Warn 'could not read backend health'
    }
}

Write-Host ''
Write-Host '  Stop everything:  .\start-all.ps1 -Stop' -ForegroundColor DarkGray
Write-Host ''

if ($frontendUp -and (-not $NoBrowser)) {
    Start-Process 'http://localhost:5173'
}
