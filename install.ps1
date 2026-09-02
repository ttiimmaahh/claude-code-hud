<#
.SYNOPSIS
    Build the Claude Code HUD and wire it into Claude Code's settings on Windows.

.DESCRIPTION
    Windows equivalent of install.sh. Installs dependencies, builds dist/,
    smoke-tests the statusline, and points Claude Code's statusLine at this
    clone. Idempotent: re-run it after moving the repo or pulling changes.

    The settings.json merge is delegated to scripts/apply-statusline.js so both
    installers share one implementation. That also avoids ConvertTo-Json, whose
    default -Depth of 2 would silently flatten nested settings (hooks,
    permissions, enabledPlugins) into "System.Object[]".

.PARAMETER SettingsPath
    Override the settings file to patch. Defaults to the .claude\settings.json
    in your home directory, resolved the same way the HUD itself resolves it.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    # If script execution is restricted (the usual default):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
    [string] $SettingsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Command($name) {
    return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

$RepoDir = $PSScriptRoot
$Entry   = Join-Path (Join-Path $RepoDir 'dist') 'index.js'

# --- Requirements ----------------------------------------------------------
if (-not (Test-Command 'node')) {
    throw "node was not found on PATH. Install Node.js 18+ from https://nodejs.org and re-run."
}
if (-not (Test-Command 'npm')) {
    throw "npm was not found on PATH. It ships with Node.js — reinstall Node.js and re-run."
}

$nodeMajor = [int](( & node --version ).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
    throw "Node.js 18+ is required; found $( & node --version )."
}

# Resolve the home directory through node, so the installer and the HUD always
# agree on where settings live (node uses USERPROFILE on Windows).
if (-not $SettingsPath) {
    $home_ = & node -e 'process.stdout.write(require("node:os").homedir())'
    $SettingsPath = Join-Path (Join-Path $home_ '.claude') 'settings.json'
}

# --- Build -----------------------------------------------------------------
Write-Host "==> Building $RepoDir"
Push-Location $RepoDir
try {
    & npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

    & npm run build --silent
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

    if (-not (Test-Path $Entry)) { throw "Build produced no $Entry" }

    # --- Smoke test --------------------------------------------------------
    # Feed the entrypoint a minimal statusline payload; a renderer that throws
    # should fail the install rather than show up as a broken terminal line.
    Write-Host '==> Verifying the HUD runs'
    $cwdJson  = ($RepoDir -replace '\\', '/')
    $payload  = @{
        hook_event_name = 'Status'
        session_id      = 'install-check'
        transcript_path = '/nonexistent.jsonl'
        cwd             = $cwdJson
        model           = @{ id = 'claude-opus-4-6'; display_name = 'Opus 4.6' }
        workspace       = @{ current_dir = $cwdJson; project_dir = $cwdJson }
    } | ConvertTo-Json -Depth 5 -Compress

    $payload | & node $Entry | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The HUD exited with code $LASTEXITCODE on a test payload." }

    # --- Wire into settings.json -------------------------------------------
    Write-Host "==> Wiring statusLine into $SettingsPath"
    $applyScript = Join-Path (Join-Path $RepoDir 'scripts') 'apply-statusline.js'
    & node $applyScript $SettingsPath $Entry
    if ($LASTEXITCODE -ne 0) { throw "Failed to update $SettingsPath" }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Done. Restart Claude Code to see the HUD.'
Write-Host "Tweak $(Join-Path $RepoDir '.claude-hud.json') to change theme, features, or thresholds."
