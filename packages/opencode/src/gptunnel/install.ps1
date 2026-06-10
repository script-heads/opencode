# TunnelCode installer for Windows (PowerShell 5.1+)
#
# Native Windows installer for the TunnelCode CLI. Mirrors the behaviour of
# install.sh: it detects the architecture, resolves the version (from
# latest.txt unless pinned), downloads the matching .zip from the release
# server, extracts tunnelcode.exe into the install dir, optionally adds that
# dir to the user PATH, and verifies the install.
#
# For x64 it first tries the default build, then transparently falls back to
# the "-baseline" build if the binary crashes (e.g. a CPU without AVX2).
#
# One-liner usage:
#   irm https://code.gptunnel.ru/install.ps1 | iex
#
# Environment variables (same semantics as install.sh):
#   TUNNELCODE_VERSION           Install a specific version (skips latest.txt).
#   TUNNELCODE_RELEASE_BASE_URL  Override the release base URL.
#   TUNNELCODE_INSTALL_DIR       Override the install bin directory.

[CmdletBinding()]
param(
    [switch]$NoModifyPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

$BaseUrl = if ($env:TUNNELCODE_RELEASE_BASE_URL) { $env:TUNNELCODE_RELEASE_BASE_URL } else { 'https://code.gptunnel.ru/releases' }
$BaseUrl = $BaseUrl.TrimEnd('/')

# Mirror install.sh's $HOME/.tunnelcode/bin so the in-binary auto-updater
# (update-notifier.ts) and `tunnelcode upgrade` write to the same location.
$InstallDir = if ($env:TUNNELCODE_INSTALL_DIR) { $env:TUNNELCODE_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.tunnelcode\bin' }

$Bin = 'tunnelcode.exe'
$Version = if ($env:TUNNELCODE_VERSION) { $env:TUNNELCODE_VERSION } else { '' }

# ---------------------------------------------------------------------------
# Output helpers (mirror install.sh info/warn/error)
# ---------------------------------------------------------------------------

function Write-Info  { param([string]$Message) Write-Host '[info] '  -ForegroundColor Green  -NoNewline; Write-Host $Message }
function Write-Warn  { param([string]$Message) Write-Host '[warn] '  -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-Err   {
    param([string]$Message)
    Write-Host '[error] ' -ForegroundColor Red -NoNewline
    Write-Host $Message
    exit 1
}

# ---------------------------------------------------------------------------
# Architecture detection
# ---------------------------------------------------------------------------

function Get-Arch {
    $procArch = $env:PROCESSOR_ARCHITECTURE
    # On ARM64 hosts a 32-bit PowerShell may report x86 while ARM64 lives in
    # PROCESSOR_ARCHITEW6432.
    if ($env:PROCESSOR_ARCHITEW6432) {
        $procArch = $env:PROCESSOR_ARCHITEW6432
    }

    switch ($procArch) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { Write-Err "Unsupported architecture: $procArch" }
    }
}

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------

function Resolve-Version {
    if ($Version) { return $Version }
    $url = "$BaseUrl/latest.txt"
    try {
        $latest = Invoke-RestMethod -Uri $url
    } catch {
        Write-Err "Failed to fetch latest version from $url"
    }
    $latest = "$latest".Trim()
    if (-not $latest) {
        Write-Err "Failed to fetch latest version from $url"
    }
    return $latest
}

# ---------------------------------------------------------------------------
# Download + extract one archive variant into the install dir
# ---------------------------------------------------------------------------

function Install-Archive {
    param(
        [Parameter(Mandatory = $true)][string]$ArchiveName,
        [Parameter(Mandatory = $true)][string]$TmpDir
    )

    $url = "$BaseUrl/v$Version/$ArchiveName"
    $tmpFile = Join-Path $TmpDir $ArchiveName

    Write-Info "Downloading TunnelCode v$Version ($ArchiveName)"
    Write-Info "URL: $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $tmpFile
    } catch {
        Write-Err "Download failed: $url"
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    # Windows can't overwrite a running .exe (e.g. when `tunnelcode upgrade` invokes
    # this installer). Rename any existing binary aside so Expand-Archive can write a
    # fresh one; the stale file is cleared on the next launch.
    $existing = Join-Path $InstallDir $Bin
    if (Test-Path -LiteralPath $existing) {
        $stale = Join-Path $InstallDir 'tunnelcode.old.exe'
        Remove-Item -LiteralPath $stale -Force -ErrorAction SilentlyContinue
        try { Move-Item -LiteralPath $existing -Destination $stale -Force } catch { }
    }

    Expand-Archive -LiteralPath $tmpFile -DestinationPath $InstallDir -Force

    $binPath = Join-Path $InstallDir $Bin
    if (-not (Test-Path -LiteralPath $binPath)) {
        Write-Err "Archive did not contain $Bin"
    }
}

# ---------------------------------------------------------------------------
# Smoke test: run the binary's --version and report success.
# A crash (e.g. illegal instruction on a non-AVX2 CPU) is treated as failure.
# ---------------------------------------------------------------------------

function Test-Binary {
    $binPath = Join-Path $InstallDir $Bin
    try {
        & $binPath --version 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Choose the right archive, download/extract it, applying the x64 baseline
# fallback when the default build fails to run.
# ---------------------------------------------------------------------------

function Install-Binary {
    param(
        [Parameter(Mandatory = $true)][string]$Arch,
        [Parameter(Mandatory = $true)][string]$TmpDir
    )

    if ($Arch -eq 'arm64') {
        # No baseline variant and no smoke test for arm64.
        Install-Archive -ArchiveName 'tunnelcode-windows-arm64.zip' -TmpDir $TmpDir
        return
    }

    # x64: try the default build first, smoke-test, fall back to baseline.
    Install-Archive -ArchiveName 'tunnelcode-windows-x64.zip' -TmpDir $TmpDir

    if (Test-Binary) {
        return
    }

    Write-Warn 'Default x64 build did not run on this CPU; falling back to the baseline build.'
    Install-Archive -ArchiveName 'tunnelcode-windows-x64-baseline.zip' -TmpDir $TmpDir
}

# ---------------------------------------------------------------------------
# PATH management (idempotent, user scope)
# ---------------------------------------------------------------------------

function Test-PathContains {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { return $false }
    foreach ($entry in $userPath.Split(';')) {
        if ($entry -and ($entry.TrimEnd('\') -ieq $InstallDir.TrimEnd('\'))) {
            return $true
        }
    }
    return $false
}

function Add-ToPath {
    if ($NoModifyPath) { return }
    if (Test-PathContains) { return }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
        $newPath = "$userPath;$InstallDir"
    } else {
        $newPath = $InstallDir
    }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')

    # Make it available in the current session too.
    $env:Path = "$env:Path;$InstallDir"

    Write-Info "Added $InstallDir to your user PATH."
    Write-Info 'Open a NEW terminal for the PATH change to take effect.'
}

# ---------------------------------------------------------------------------
# Final verification (non-fatal)
# ---------------------------------------------------------------------------

function Invoke-SelfCheck {
    $binPath = Join-Path $InstallDir $Bin
    if (Test-Binary) {
        Write-Info "Installed to $binPath"
    } else {
        Write-Warn "Installed to $binPath, but the version check failed"
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Main {
    Write-Host 'TunnelCode Installer' -ForegroundColor White
    Write-Host ''

    $arch = Get-Arch
    $script:Version = Resolve-Version

    $tmpDir = Join-Path $env:TEMP ("tunnelcode-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    try {
        Install-Binary -Arch $arch -TmpDir $tmpDir
    } finally {
        if (Test-Path -LiteralPath $tmpDir) {
            Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Add-ToPath
    Invoke-SelfCheck

    Write-Host ''
    Write-Info "TunnelCode v$Version installed successfully"
    Write-Host '  Run: ' -NoNewline; Write-Host 'tunnelcode' -ForegroundColor White
    if (-not (Test-PathContains) -and -not $NoModifyPath) {
        Write-Host '  PATH not updated in this shell.' -ForegroundColor Yellow
    }
    if (-not $NoModifyPath) {
        Write-Host '  Open a new terminal for the PATH change to take effect.' -ForegroundColor Yellow
    }
}

Main
