@echo off
rem Starts JARVIS silently at every Windows sign-in and creates Desktop / Start menu shortcuts.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" %*
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcuts.ps1"
pause
