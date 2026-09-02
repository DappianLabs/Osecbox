@echo off
REM Disable Ubuntu MOTD messages in WSL2
REM Run this script to permanently disable the welcome messages

echo Disabling Ubuntu MOTD messages in WSL2...

REM Method 1: Create .hushlogin in WSL home directory
wsl bash -c "touch ~/.hushlogin && echo '✅ Created ~/.hushlogin'"

REM Method 2: Add environment variables to .bashrc
wsl bash -c "if ! grep -q 'NO_MOTD' ~/.bashrc; then echo '' >> ~/.bashrc && echo '# Disable MOTD messages' >> ~/.bashrc && echo 'export NO_MOTD=1' >> ~/.bashrc && echo 'export MOTD_SHOWN=pam' >> ~/.bashrc && echo 'export DISABLE_MOTD=1' >> ~/.bashrc && echo '✅ Added MOTD variables to ~/.bashrc'; else echo 'MOTD variables already in ~/.bashrc'; fi"

REM Method 3: Disable MOTD scripts (requires sudo)
wsl bash -c "if [ -d '/etc/update-motd.d' ]; then sudo chmod -x /etc/update-motd.d/* 2>/dev/null && echo '✅ Disabled MOTD scripts'; fi"

REM Method 4: Disable news messages (requires sudo)
wsl bash -c "if [ -f '/etc/default/motd-news' ]; then sudo sed -i 's/ENABLED=1/ENABLED=0/' /etc/default/motd-news 2>/dev/null && echo '✅ Disabled MOTD news'; fi"

echo.
echo ✅ MOTD disabled successfully!
echo.
echo The welcome message will no longer appear in new terminals.
echo Changes will take effect immediately for new terminal sessions.
echo.
pause
