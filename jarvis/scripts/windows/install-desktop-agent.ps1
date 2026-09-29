<#
  Installs the JARVIS desktop agent for the current Windows user:
    - Python packages into %LOCALAPPDATA%\JARVIS\desktop-venv
    - config %LOCALAPPDATA%\JARVIS\desktop.env (JARVIS address + device token, readable only by you)
    - a Task Scheduler task that starts the agent silently (pythonw, no window) at every sign-in
  Needs Python 3.10+ (https://www.python.org/downloads/ or: winget install Python.Python.3.12).
    -Token   device token with the "computer" scope (asked for if omitted)
    -Url     JARVIS address (default: JARVIS_PUBLIC_URL from .env)
#>
param([string]$Token, [string]$Url)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$agentDir = Join-Path $JarvisRoot 'desktop'
$venv = Join-Path $JarvisLogDir 'desktop-venv'
$config = Join-Path $JarvisLogDir 'desktop.env'

$py = Get-Command py -ErrorAction SilentlyContinue
$pyArgs = @('-3')
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue; $pyArgs = @() }
if (-not $py) { throw 'Python 3 was not found. Install it (winget install Python.Python.3.12) and run this again.' }

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    Write-Host 'Creating the Python environment...'
    & $py.Source @pyArgs -m venv $venv
}
$vpy = Join-Path $venv 'Scripts\python.exe'
Write-Host 'Installing packages...'
& $vpy -m pip install --disable-pip-version-check -q -r (Join-Path $agentDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

if (-not $Url) { $Url = Get-JarvisUrl }
if (-not $Token -and (Test-Path $config)) {
    $existing = Select-String -Path $config -Pattern '^JARVIS_DEVICE_TOKEN=(.+)$' | Select-Object -First 1
    if ($existing) { $Token = $existing.Matches[0].Groups[1].Value }
}
if (-not $Token) {
    Write-Host 'Create a token in JARVIS: Settings > Sessions and devices > "Computer" token.'
    $Token = Read-Host 'Paste the device token'
}
if (-not $Token) { throw 'A device token is required.' }

$lines = @(
    '# Written by install-desktop-agent.ps1. Options: desktop/.env.example',
    "JARVIS_URL=$Url",
    "JARVIS_DEVICE_TOKEN=$Token",
    "JARVIS_DEVICE_NAME=$env:COMPUTERNAME",
    'JARVIS_ALLOW_SHELL=0'
)
Set-Content -Path $config -Value $lines -Encoding UTF8
# only this user may read the token
& icacls $config /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$pyw = Join-Path $venv 'Scripts\pythonw.exe'
$script = Join-Path $agentDir 'jarvis_desktop.py'
$logFile = Join-Path $JarvisLogDir 'desktop-agent.log'
& $vpy $script --config $config --check

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $pyw -Argument "`"$script`" --config `"$config`" --log `"$logFile`"" `
    -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'JARVIS Desktop Agent' -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Lets JARVIS control this computer (desktop/jarvis_desktop.py).' -Force | Out-Null
Start-ScheduledTask -TaskName 'JARVIS Desktop Agent'
Write-Host "OK: the agent is running and will start at every sign-in. Log: $logFile"
Write-Host 'Check in JARVIS: Settings > Devices shows this computer as online.'
