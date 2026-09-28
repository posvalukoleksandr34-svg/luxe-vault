<#
  Starts JARVIS: launches Docker Desktop if needed, waits for the engine, then `docker compose up -d`.
  Used by the logon task (install-autostart.ps1) and by start-jarvis.bat.
    -OpenApp          open the JARVIS window once the web UI answers
    -TimeoutMinutes   how long to wait for Docker (default 10)
  Log: %LOCALAPPDATA%\JARVIS\jarvis.log
#>
param([switch]$OpenApp, [int]$TimeoutMinutes = 10)
$ErrorActionPreference = 'Continue'   # docker writes progress to stderr; never treat that as fatal
. (Join-Path $PSScriptRoot 'common.ps1')

Write-JarvisLog "start requested (root: $JarvisRoot)"
$docker = Get-DockerExe
if (-not $docker) { Write-JarvisLog 'docker CLI not found - is Docker Desktop installed?'; exit 1 }

function Test-DockerEngine { & $docker info *> $null; return ($LASTEXITCODE -eq 0) }

if (-not (Test-DockerEngine)) {
    $desktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path $desktop)) {
        Write-JarvisLog 'starting Docker Desktop'
        Start-Process -FilePath $desktop -WindowStyle Minimized
    }
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while (-not (Test-DockerEngine)) {
        if ((Get-Date) -gt $deadline) { Write-JarvisLog "Docker engine not ready after $TimeoutMinutes min - giving up"; exit 1 }
        Start-Sleep -Seconds 5
    }
}
Write-JarvisLog 'Docker engine ready'

Push-Location $JarvisRoot
try {
    $out = & $docker compose up -d 2>&1
    $code = $LASTEXITCODE
    $out | ForEach-Object { Write-JarvisLog "compose: $_" }
} finally { Pop-Location }
if ($code -ne 0) { Write-JarvisLog "docker compose up failed (exit $code)"; exit $code }
Write-JarvisLog 'JARVIS containers are up'

if ($OpenApp) {
    $url = Get-JarvisUrl
    $deadline = (Get-Date).AddMinutes(5)
    do {
        try { $ok = (Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $ok = $false }
        if (-not $ok) { Start-Sleep -Seconds 3 }
    } until ($ok -or (Get-Date) -gt $deadline)
    & (Join-Path $PSScriptRoot 'jarvis-open.ps1') -Url $url
}
exit 0
