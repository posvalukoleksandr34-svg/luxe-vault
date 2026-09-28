# Removes the JARVIS sign-in task. Containers keep running until you stop them (docker compose down).
$task = Get-ScheduledTask -TaskName 'JARVIS Autostart' -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName 'JARVIS Autostart' -Confirm:$false
    Write-Host "OK: autostart removed."
} else {
    Write-Host "Autostart was not installed."
}
