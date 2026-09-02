#!/bin/bash
# Install Metasploit on Ubuntu

echo "Installing Metasploit Framework on Ubuntu..."

# Download and run official installer
curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > /tmp/msfinstall
chmod 755 /tmp/msfinstall
sudo /tmp/msfinstall

echo "Metasploit installation complete!"
echo "Run 'msfconsole' to verify"
