@echo off
rem Read-only DNS preflight in the default WSL2 runtime.

call "%~dp0check-wsl2.bat"
if errorlevel 1 exit /b 1

set "OSECBOX_DNS_TARGET=%~1"
if defined OSECBOX_DNS_TARGET (
    echo(%OSECBOX_DNS_TARGET%| findstr.exe /r /x "[A-Za-z0-9][A-Za-z0-9.-]*" >nul
    if errorlevel 1 (
        echo Target must be a hostname such as app.example.com. URLs and shell characters are not accepted.
        exit /b 2
    )
    wsl.exe -e bash "%OSECBOX_WSL_REPO_ROOT%/scripts/setup/check-dns.sh" "%OSECBOX_DNS_TARGET%"
) else (
    wsl.exe -e bash "%OSECBOX_WSL_REPO_ROOT%/scripts/setup/check-dns.sh"
)

if errorlevel 1 (
    echo.
    echo DNS preflight failed. Review the classification and remediation above.
    exit /b 1
)
exit /b 0
