<#
  Creates "JARVIS" shortcuts on the Desktop and in the Start menu. They open JARVIS in its own
  window (Edge/Chrome app mode: no address bar, no tabs, own taskbar icon). Pin it to the taskbar
  from the Start menu entry. Re-run after changing JARVIS_PUBLIC_URL / HTTP_PORT in .env.
#>
. (Join-Path $PSScriptRoot 'common.ps1')
$url = Get-JarvisUrl
$browser = Get-AppBrowser
$icon = Join-Path $PSScriptRoot 'jarvis.ico'
$shell = New-Object -ComObject WScript.Shell

$places = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('Programs')   # Start menu
)
foreach ($dir in $places) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'JARVIS.lnk'))
    if ($browser) {
        $lnk.TargetPath = $browser
        $lnk.Arguments = "--app=$url --window-size=1400,900"
        $lnk.WorkingDirectory = Split-Path $browser
    } else {
        $lnk.TargetPath = 'powershell.exe'
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'jarvis-open.ps1')`""
        $lnk.WorkingDirectory = $PSScriptRoot
    }
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'JARVIS - personal AI agent'
    $lnk.Save()
    Write-Host "OK: $(Join-Path $dir 'JARVIS.lnk')"
}
Write-Host "Opens: $url"
