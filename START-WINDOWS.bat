@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 20 or later from https://nodejs.org
  pause
  exit /b 1
)
echo.
echo THE DEAL - Party Game

echo Open http://localhost:3000 on this computer.
echo Keep this window open while playing.
echo.
start "" http://localhost:3000
node server.js
pause