@echo off
REM OsecBox listener setup

call "%~dp0check-wsl2.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo ========================================
echo OsecBox - Listener Setup
echo ========================================
echo.
echo This will open a WSL2 terminal with a listener
echo.
echo Available listeners:
echo   1. Netcat (simple)
echo   2. Pwncat-cs (recommended - modern shell handler)
echo   3. Socat (advanced)
echo   4. Metasploit handler
echo.

set /p choice="Choose listener (1-4): "

if "%choice%"=="1" (
    echo Starting Netcat listener on port 4444...
    wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && nc -lvnp 4444"
) else if "%choice%"=="2" (
    echo Starting Pwncat-cs listener on port 4444...
    wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && pwncat-cs -lp 4444"
) else if "%choice%"=="3" (
    echo Starting Socat listener on port 4444...
    wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/bin/bash"
) else if "%choice%"=="4" (
    echo Starting Metasploit handler...
    wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && ./setup-listeners.sh msf"
) else (
    echo Invalid choice!
    pause
    exit /b 1
)
