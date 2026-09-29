@echo off
rem Lets JARVIS control this computer (apps, media, volume, windows...). Asks for a device token.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop-agent.ps1" %*
pause
