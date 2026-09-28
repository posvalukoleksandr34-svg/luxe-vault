<#
  Opens JARVIS in its own app window (no address bar, no tabs) using Edge or Chrome app mode.
#>
param([string]$Url)
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not $Url) { $Url = Get-JarvisUrl }
$browser = Get-AppBrowser
if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$Url", '--window-size=1400,900'
} else {
    Write-JarvisLog 'neither Edge nor Chrome found - opening the default browser'
    Start-Process $Url
}
