<#
  Creates "JARVIS" and "JARVIS Mini" (compact voice window) shortcuts on the Desktop and in the Start menu. They open JARVIS in its own
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
$variants = @(
    @{ Name = 'JARVIS'; Url = $url; Size = '1400,900'; Desc = 'JARVIS - personal AI agent' },
    @{ Name = 'JARVIS Mini'; Url = ($url.TrimEnd('/') + '/mini'); Size = '380,600'; Desc = 'JARVIS - compact voice window' }
)
foreach ($dir in $places) {
    foreach ($v in $variants) {
        $path = Join-Path $dir ($v.Name + '.lnk')
        $lnk = $shell.CreateShortcut($path)
        if ($browser) {
            $lnk.TargetPath = $browser
            $lnk.Arguments = "--app=$($v.Url) --window-size=$($v.Size)"
            $lnk.WorkingDirectory = Split-Path $browser
        } else {
            $lnk.TargetPath = 'powershell.exe'
            $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'jarvis-open.ps1')`" -Url `"$($v.Url)`""
            $lnk.WorkingDirectory = $PSScriptRoot
        }
        $lnk.IconLocation = "$icon,0"
        $lnk.Description = $v.Desc
        $lnk.Save()
        Write-Host "OK: $path"
    }
}
Write-Host "Opens: $url"
