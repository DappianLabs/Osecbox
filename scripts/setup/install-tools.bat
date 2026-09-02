@echo off
call "%~dp0check-wsl2.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo Installing pentesting tools in WSL2...
echo.
echo This will install:
echo   - Nmap, Nikto, and Gobuster
echo   - Subfinder, httpx, Nuclei, and Assetfinder
echo   - Amass, ffuf, and Findomain
echo.
echo You will be prompted for your WSL2 sudo password.
echo.
pause

wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && chmod +x install-tools.sh && ./install-tools.sh"
if errorlevel 1 goto :failed

echo.
echo Installation complete! Please restart OffSecBox.
pause
exit /b 0

:failed
echo.
echo Core tool installation failed. Review the WSL output above.
pause
exit /b 1
