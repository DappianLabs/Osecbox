@echo off
rem Shared preflight for the Windows-to-WSL2 setup scripts.

set "OSECBOX_WSL_REPO_ROOT="
set "OSECBOX_REPO_ROOT=%~dp0..\.."

where wsl.exe >nul 2>&1
if errorlevel 1 (
    echo WSL is not installed or wsl.exe is not on PATH.
    echo Install it from an elevated PowerShell window with:
    echo   wsl --install -d Ubuntu
    exit /b 1
)

for /f "delims=" %%I in ('wsl.exe wslpath -a "%OSECBOX_REPO_ROOT%" 2^>nul') do if not defined OSECBOX_WSL_REPO_ROOT set "OSECBOX_WSL_REPO_ROOT=%%I"
if not defined OSECBOX_WSL_REPO_ROOT (
    echo WSL is installed, but no default Linux distribution is configured.
    echo List distributions with: wsl --list --online
    echo Install one with: wsl --install -d Ubuntu
    echo Set the preferred distribution with: wsl --set-default ^<DistroName^>
    exit /b 1
)

rem Do not trust ERRORLEVEL alone here: some WSL service failures print an
rem error but return zero when launched from cmd.exe. Require an output marker.
set "OSECBOX_WSL_READY="
for /f "delims=" %%I in ('wsl.exe -e bash -c "printf OSECBOX_WSL_READY" 2^>nul') do if not defined OSECBOX_WSL_READY set "OSECBOX_WSL_READY=%%I"
if /i not "%OSECBOX_WSL_READY%"=="OSECBOX_WSL_READY" (
    echo WSL is installed but cannot start the default distribution.
    echo The host reported an access/service error. Restart the WSL service or reboot Windows, then rerun this check.
    exit /b 1
)

set "OSECBOX_WSL_KERNEL="
for /f "delims=" %%I in ('wsl.exe -e uname -r 2^>nul') do if not defined OSECBOX_WSL_KERNEL set "OSECBOX_WSL_KERNEL=%%I"
echo(%OSECBOX_WSL_KERNEL%| findstr.exe /i /c:"microsoft-standard-WSL2" >nul
if errorlevel 1 (
    echo The default WSL distribution is not running on WSL2.
    echo Convert it with: wsl --set-version ^<DistroName^> 2
    exit /b 1
)

set "OSECBOX_APT_PATH="
for /f "delims=" %%I in ('wsl.exe -e bash -c "command -v apt-get" 2^>nul') do if not defined OSECBOX_APT_PATH set "OSECBOX_APT_PATH=%%I"
if not defined OSECBOX_APT_PATH (
    echo The default WSL2 distribution is not Debian-family or does not provide apt.
    echo Use the in-app installation instructions for its package manager.
    exit /b 1
)

exit /b 0
