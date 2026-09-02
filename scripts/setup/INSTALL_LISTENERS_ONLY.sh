#!/bin/bash
# Install ONLY listeners/handlers that show in the UI
# For Metasploit Handler Manager and Foothold sections

echo "=========================================="
echo "Installing Listeners for UI Demo"
echo "=========================================="
echo ""
echo "These tools will be visible in:"
echo "  - Metasploit Handler Manager"
echo "  - Foothold View (Listeners)"
echo "  - Tunneling/Pivot sections"
echo ""

# Metasploit is already installed (v6.4.126)
echo "[✓] Metasploit Framework already installed"

# Install netcat-openbsd (better than traditional for listeners)
if ! command -v nc &> /dev/null; then
    echo "[+] Installing netcat..."
    sudo apt install -y netcat-openbsd
else
    echo "[✓] Netcat already installed"
fi

# Install socat (advanced listener for pivoting)
if ! command -v socat &> /dev/null; then
    echo "[+] Installing socat (for port forwarding/pivoting)..."
    sudo apt install -y socat
else
    echo "[✓] Socat already installed"
fi

# Install chisel (for tunneling - shows in UI)
if ! command -v chisel &> /dev/null; then
    echo "[+] Installing chisel (for tunneling)..."
    wget -q https://github.com/jpillora/chisel/releases/latest/download/chisel_linux_amd64.gz
    gunzip chisel_linux_amd64.gz
    chmod +x chisel_linux_amd64
    sudo mv chisel_linux_amd64 /usr/local/bin/chisel
else
    echo "[✓] Chisel already installed"
fi

echo ""
echo "=========================================="
echo "Installation Complete!"
echo "=========================================="
echo ""
echo "Installed Listeners:"
echo "  ✓ Metasploit handlers (multi/handler)"
echo "  ✓ Netcat (nc -lvnp <port>)"
echo "  ✓ Socat (port forwarding/pivoting)"
echo "  ✓ Chisel (HTTP tunneling)"
echo ""
echo "These will show in the UI:"
echo "  - Metasploit View → Handlers tab"
echo "  - Foothold View → Listener management"
echo "  - Tunneling View → Port forwarding"
echo ""
