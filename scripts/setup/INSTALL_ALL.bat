@echo off
REM OsecBox WSL2 environment setup

call "%~dp0check-wsl2.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo ========================================
echo OsecBox - HTB Setup Installer
echo ========================================
echo.
echo This will install additional pentesting tools in your default WSL2 distro
echo Estimated time: 5-10 minutes
echo.
echo Tools to be installed:
echo   - hydra (password attacks)
echo   - john (password cracking)
echo   - sqlmap (SQL injection)
echo   - socat (advanced listener)
echo   - pwncat-cs (modern shell handler)
echo   - exploitdb (searchsploit)
echo.
pause

echo.
echo [1/4] Installing APT packages...
wsl.exe -e bash -lc "sudo apt update && sudo apt install -y hydra john sqlmap socat exploitdb"
if errorlevel 1 goto :failed

echo.
echo [2/4] Installing pwncat-cs...
wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && chmod +x install-missing-only.sh && ./install-missing-only.sh"
if errorlevel 1 goto :failed

echo.
echo [3/4] Updating PATH for Go tools...
wsl.exe -e bash -lc "grep -q 'export PATH=\$PATH:\$HOME/go/bin' ~/.bashrc || echo 'export PATH=\$PATH:\$HOME/go/bin' >> ~/.bashrc"
if errorlevel 1 goto :failed

echo.
echo [4/4] Making scripts executable...
wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && chmod +x *.sh"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Configure the AI provider in the app Settings screen
echo   2. Connect OpenVPN to HTB if you are using an HTB target
echo   3. Launch the packaged app or run npm run dev:electron from a source checkout
echo.
echo To verify installation:
echo   wsl.exe -e bash -lc "cd '%OSECBOX_WSL_REPO_ROOT%/scripts/setup' && ./check-htb-readiness.sh"
echo.
pause
exit /b 0

:failed
echo.
echo Additional tool installation failed. Review the WSL output above.
pause
exit /b 1
