#!/usr/bin/env bash
# Install the core OsecBox tools in a Debian-family WSL2 distribution.

set -euo pipefail

echo "Installing OsecBox pentesting tools..."
echo "Updating package lists..."
sudo apt-get update

echo "Installing core packages..."
sudo apt-get install -y nmap nikto gobuster curl wget git golang-go python3 python3-pip unzip ca-certificates

echo "Configuring Go tools..."
export GOPATH="${GOPATH:-$HOME/go}"
export PATH="$PATH:$GOPATH/bin"
mkdir -p "$GOPATH/bin"

if ! grep -q 'export GOPATH=' "$HOME/.bashrc" 2>/dev/null; then
    printf '\nexport GOPATH="$HOME/go"\nexport PATH="$PATH:$GOPATH/bin"\n' >> "$HOME/.bashrc"
fi

echo "Installing ProjectDiscovery and Go tools..."
go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install github.com/projectdiscovery/httpx/cmd/httpx@latest
go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
go install github.com/tomnomnom/assetfinder@latest
go install github.com/owasp-amass/amass/v4/...@latest
go install github.com/ffuf/ffuf/v2@latest

echo "Installing Findomain..."
case "$(uname -m)" in
    x86_64|amd64) findomain_asset="findomain-linux.zip" ;;
    aarch64|arm64) findomain_asset="findomain-aarch64.zip" ;;
    armv7l|armv7) findomain_asset="findomain-armv7.zip" ;;
    i386|i686) findomain_asset="findomain-linux-i386.zip" ;;
    *) echo "Unsupported architecture for Findomain: $(uname -m)"; exit 1 ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
wget -q "https://github.com/Findomain/Findomain/releases/latest/download/${findomain_asset}" -O "$tmp_dir/findomain.zip"
unzip -q "$tmp_dir/findomain.zip" -d "$tmp_dir"
chmod +x "$tmp_dir/findomain"
sudo install -m 0755 "$tmp_dir/findomain" /usr/local/bin/findomain

echo "Verifying installations..."
tools=(nmap nikto gobuster subfinder httpx nuclei assetfinder amass ffuf findomain)
missing=0
for tool in "${tools[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        version="$($tool --version 2>&1 | head -n1 || true)"
        printf 'OK      %s: %s\n' "$tool" "${version:-installed}"
    else
        printf 'MISSING %s\n' "$tool"
        missing=1
    fi
done

if [ "$missing" -ne 0 ]; then
    echo "Some tools were not found. Open a new WSL shell or check the Go bin path."
    exit 1
fi

echo "Core tool installation finished successfully."
echo "If this shell cannot find Go tools, run: source ~/.bashrc"
