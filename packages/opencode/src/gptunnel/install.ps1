# TunnelCode installer for Windows (PowerShell 5.1+)
#
# Native Windows installer for the TunnelCode CLI. Mirrors the behaviour of
# install.sh: it detects the architecture, resolves the version (from
# latest.txt unless pinned), downloads the matching .zip from the release
# server into a temp dir, smoke-tests the binary there, swaps it into the
# install dir, optionally adds that dir to the user PATH, and verifies the
# install. The installed binary is not touched until the new one is known good.
#
# For x64 it first tries the default build, then transparently falls back to
# the "-baseline" build if the binary crashes (e.g. a CPU without AVX2).
#
# One-liner usage:
#   irm https://code.gptunnel.ru/install.ps1 | iex
#
# The in-binary auto-updater (update-notifier.ts) and `tunnelcode upgrade`
# run this same script with $env:TUNNELCODE_VERSION pinned, so all Windows
# install/upgrade paths share this one implementation.
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

# Mirror install.sh's $HOME/.tunnelcode/bin so `tunnelcode upgrade` and the
# auto-updater (both of which re-run this script) write to the same location.
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
    # throw, not `exit`: under `irm ... | iex` the script runs in the user's
    # session, and `exit` would close their terminal along with this message.
    throw "TunnelCode install failed: $Message"
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
        $latest = "$(Invoke-RestMethod -Uri $url)".Trim()
    } catch {
        $latest = ''
    }
    if (-not $latest) {
        Write-Err "Failed to fetch latest version from $url"
    }
    return $latest
}

# ---------------------------------------------------------------------------
# Download one archive variant and extract it into the temp dir.
# Returns the path of the extracted binary; the install dir is not touched.
# ---------------------------------------------------------------------------

function Get-Binary {
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

    $extractDir = Join-Path $TmpDir ([IO.Path]::GetFileNameWithoutExtension($ArchiveName))
    Expand-Archive -LiteralPath $tmpFile -DestinationPath $extractDir -Force

    $binPath = Join-Path $extractDir $Bin
    if (-not (Test-Path -LiteralPath $binPath)) {
        Write-Err "Archive did not contain $Bin"
    }
    return $binPath
}

# ---------------------------------------------------------------------------
# Smoke test: run the binary's --version and report success.
# A crash (e.g. illegal instruction on a non-AVX2 CPU) is treated as failure.
# ---------------------------------------------------------------------------

function Test-Binary {
    param([Parameter(Mandatory = $true)][string]$BinPath)
    # PS 5.1 quirk: with EAP 'Stop' a redirected stderr line becomes a
    # terminating NativeCommandError, failing the test even on exit code 0.
    # The assignment is function-scoped and does not leak to the caller.
    $ErrorActionPreference = 'Continue'
    try {
        & $BinPath --version 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# ---------------------------------------------------------------------------
# Choose the right archive and fetch it into the temp dir, applying the x64
# baseline fallback when the default build fails to run.
# ---------------------------------------------------------------------------

function Select-Binary {
    param(
        [Parameter(Mandatory = $true)][string]$Arch,
        [Parameter(Mandatory = $true)][string]$TmpDir
    )

    if ($Arch -eq 'arm64') {
        # No baseline variant and no smoke test for arm64.
        return Get-Binary -ArchiveName 'tunnelcode-windows-arm64.zip' -TmpDir $TmpDir
    }

    # x64: try the default build first, smoke-test it in the temp dir,
    # fall back to baseline.
    $binPath = Get-Binary -ArchiveName 'tunnelcode-windows-x64.zip' -TmpDir $TmpDir
    if (Test-Binary -BinPath $binPath) {
        return $binPath
    }

    Write-Warn 'Default x64 build did not run on this CPU; falling back to the baseline build.'
    return Get-Binary -ArchiveName 'tunnelcode-windows-x64-baseline.zip' -TmpDir $TmpDir
}

# ---------------------------------------------------------------------------
# Swap the verified binary into the install dir.
# ---------------------------------------------------------------------------

function Install-Binary {
    param(
        [Parameter(Mandatory = $true)][string]$BinPath
    )

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    $target = Join-Path $InstallDir $Bin
    $stale = Join-Path $InstallDir 'tunnelcode.old.exe'

    # Windows can't overwrite a running .exe (e.g. when `tunnelcode upgrade`
    # invokes this installer), but it can rename one: move the existing binary
    # aside, then drop the new one in place. The stale file is cleared on the
    # next launch (see update-notifier.ts).
    $movedAside = $false
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $stale -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $target -Destination $stale -Force
        $movedAside = $true
    }

    try {
        Move-Item -LiteralPath $BinPath -Destination $target -Force
    } catch {
        # Put the original binary back so a failed install doesn't break a working one.
        if ($movedAside) {
            Move-Item -LiteralPath $stale -Destination $target -Force -ErrorAction SilentlyContinue
        }
        Write-Err "Failed to install $Bin into $InstallDir"
    }
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
    if (Test-Binary -BinPath $binPath) {
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
        $binPath = Select-Binary -Arch $arch -TmpDir $tmpDir
        Install-Binary -BinPath $binPath
    } finally {
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Add-ToPath
    Invoke-SelfCheck

    Write-Host ''
    Write-Info "TunnelCode v$Version installed successfully"
    Write-Host '  Run: ' -NoNewline; Write-Host 'tunnelcode' -ForegroundColor White
}

Main
