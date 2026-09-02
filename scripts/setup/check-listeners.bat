@echo off
rem Cross-platform listener/tunnel preflight. This wrapper is read-only unless
rem --loopback is passed, in which case only 127.0.0.1 is exercised.

set "OSECBOX_REPO_ROOT=%~dp0..\.."
set "OSECBOX_WSL_REPO_ROOT="

where wsl.exe >nul 2>&1
if errorlevel 1 (
    echo WSL is not installed or wsl.exe is not on PATH.
    echo Install or enable WSL2, then rerun this check.
    exit /b 1
)

for /f "delims=" %%I in ('wsl.exe wslpath -a "%OSECBOX_REPO_ROOT%" 2^>nul') do if not defined OSECBOX_WSL_REPO_ROOT set "OSECBOX_WSL_REPO_ROOT=%%I"
if not defined OSECBOX_WSL_REPO_ROOT (
    echo WSL is installed, but the default distribution could not translate the OsecBox path.
    echo The host reported a WSL service/access problem, not a listener or DNS problem.
    echo Restart the WSL service or reboot Windows, then rerun this check.
    exit /b 1
)

set "OSECBOX_WSL_READY="
for /f "delims=" %%I in ('wsl.exe -e bash -c "printf OSECBOX_WSL_READY" 2^>nul') do if not defined OSECBOX_WSL_READY set "OSECBOX_WSL_READY=%%I"
if /i not "%OSECBOX_WSL_READY%"=="OSECBOX_WSL_READY" (
    echo WSL is installed but cannot start the default distribution.
    echo The host reported a service/access error, not a DNS error.
    echo Restart the WSL service or reboot Windows, then rerun this check.
    exit /b 1
)

set "OSECBOX_LISTENER_ARG=%~1"
if defined OSECBOX_LISTENER_ARG if /i not "%OSECBOX_LISTENER_ARG%"=="--loopback" (
    echo Usage: check-listeners.bat [--loopback]
    exit /b 2
)

if defined OSECBOX_LISTENER_ARG (
    wsl.exe -e bash "%OSECBOX_WSL_REPO_ROOT%/scripts/setup/check-listeners.sh" --loopback
) else (
    wsl.exe -e bash "%OSECBOX_WSL_REPO_ROOT%/scripts/setup/check-listeners.sh"
)

if errorlevel 1 exit /b 1
exit /b 0

