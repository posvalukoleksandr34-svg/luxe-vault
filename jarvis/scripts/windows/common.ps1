# Shared helpers for the JARVIS Windows scripts (dot-sourced).
$JarvisRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$JarvisLogDir = Join-Path $env:LOCALAPPDATA 'JARVIS'
New-Item -ItemType Directory -Force -Path $JarvisLogDir | Out-Null
$JarvisLog = Join-Path $JarvisLogDir 'jarvis.log'

function Write-JarvisLog([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -Path $JarvisLog -Encoding UTF8
}

# The URL JARVIS is served on: JARVIS_PUBLIC_URL from .env, else http://localhost[:HTTP_PORT].
function Get-JarvisUrl {
    $envFile = Join-Path $JarvisRoot '.env'
    $url = $null; $port = $null
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match '^\s*JARVIS_PUBLIC_URL\s*=\s*(\S+)') { $url = $Matches[1].Trim('"', "'") }
            if ($line -match '^\s*HTTP_PORT\s*=\s*(\d+)') { $port = $Matches[1] }
        }
    }
    if ($url) { return $url.TrimEnd('/') }
    if ($port -and $port -ne '80') { return "http://localhost:$port" }
    return 'http://localhost'
}

# Edge is on every Windows 10/11; Chrome works the same way. $null = neither found.
function Get-AppBrowser {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Get-DockerExe {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}
