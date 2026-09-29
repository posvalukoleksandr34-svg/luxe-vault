@echo off
rem Starts Docker Desktop (if needed) and JARVIS, then opens the JARVIS window.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0jarvis-start.ps1" -OpenApp
