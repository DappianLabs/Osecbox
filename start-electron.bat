@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13.0 or newer is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); if (v[0] < 22 || (v[0] === 22 && v[1] < 13)) process.exit(1)"
if errorlevel 1 (
  echo Node.js 22.13.0 or newer is required. Upgrade Node.js and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing project dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your network and npm configuration.
    pause
    exit /b 1
  )
)

start "OsecBox Vite Dev Server" /D "%~dp0" cmd /k "npm.cmd run dev:client"
timeout /t 5 /nobreak >nul
start "OsecBox Electron" /D "%~dp0" cmd /k "npm.cmd run compile:electron && npx.cmd electron ."
exit /b 0
