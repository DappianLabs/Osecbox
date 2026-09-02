#!/bin/bash
# Disable Ubuntu MOTD (Message of the Day) messages
# Run this script to permanently disable the welcome messages

echo "Disabling Ubuntu MOTD messages..."

# Method 1: Disable MOTD scripts
if [ -d "/etc/update-motd.d" ]; then
  echo "Disabling MOTD scripts in /etc/update-motd.d..."
  sudo chmod -x /etc/update-motd.d/*
fi

# Method 2: Create empty MOTD file
echo "Creating empty MOTD file..."
sudo touch /etc/motd
sudo chmod 644 /etc/motd

# Method 3: Disable news messages
if [ -f "/etc/default/motd-news" ]; then
  echo "Disabling MOTD news..."
  sudo sed -i 's/ENABLED=1/ENABLED=0/' /etc/default/motd-news
fi

# Method 4: Add to bashrc
if ! grep -q "NO_MOTD" ~/.bashrc; then
  echo "Adding NO_MOTD to ~/.bashrc..."
  echo "" >> ~/.bashrc
  echo "# Disable MOTD messages" >> ~/.bashrc
  echo "export NO_MOTD=1" >> ~/.bashrc
  echo "export MOTD_SHOWN=pam" >> ~/.bashrc
fi

# Method 5: Touch hushlogin (silences all login messages)
echo "Creating ~/.hushlogin..."
touch ~/.hushlogin

echo "✅ MOTD disabled successfully!"
echo "Please restart your terminal or run: source ~/.bashrc"
