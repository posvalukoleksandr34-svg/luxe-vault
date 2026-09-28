<#
  Registers a Task Scheduler task that starts JARVIS silently when you sign in to Windows.
    -OpenApp   also open the JARVIS window after sign-in
  Undo: uninstall-autostart.ps1 (or uninstall-autostart.bat).
#>
param([switch]$OpenApp)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$taskName = 'JARVIS Autostart'
$user = "$env:USERDOMAIN\$env:USERNAME"
$extra = if ($OpenApp) { ' -OpenApp' } else { '' }
$vbs = Join-Path $PSScriptRoot 'jarvis-start-hidden.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (Test-Path $wscript) {
    # wscript + window style 0: not even a console flash
    $action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"$extra" -WorkingDirectory $PSScriptRoot
} else {
    # VBScript removed from this Windows: hidden PowerShell (may flash for a split second)
    $ps1 = Join-Path $PSScriptRoot 'jarvis-start.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $PSScriptRoot `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`"$extra"
}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT20S'   # let the desktop settle first
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Starts the JARVIS Docker containers at sign-in (scripts/windows/jarvis-start.ps1).' -Force | Out-Null

Write-Host "OK: task '$taskName' registered for $user."
Write-Host "JARVIS will start silently at every sign-in. Log: $JarvisLog"
Write-Host "Tip: in Docker Desktop > Settings > General, 'Start Docker Desktop when you sign in' can stay off -"
Write-Host "     the task starts Docker Desktop itself."
