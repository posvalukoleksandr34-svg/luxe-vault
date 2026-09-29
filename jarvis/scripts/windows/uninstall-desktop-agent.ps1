# Stops and removes the JARVIS desktop agent task (the venv and config stay in %LOCALAPPDATA%\JARVIS).
$task = Get-ScheduledTask -TaskName 'JARVIS Desktop Agent' -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName 'JARVIS Desktop Agent' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'JARVIS Desktop Agent' -Confirm:$false
    Write-Host 'OK: desktop agent removed. Revoke its token in JARVIS > Settings > Sessions and devices.'
} else {
    Write-Host 'The desktop agent was not installed.'
}
