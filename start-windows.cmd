@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo Starting Agy Relay Deck at http://127.0.0.1:7331
echo Keep this window open while using the panel.
node server.mjs

echo.
echo Agy Relay Deck stopped.
pause
