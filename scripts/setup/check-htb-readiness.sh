#!/bin/bash
# OsecBox environment readiness check

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "OsecBox - HTB Readiness Check"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check function
check_tool() {
    local tool=$1
    local name=$2
    
    if command -v $tool &> /dev/null; then
        local version=$($tool --version 2>&1 | head -1 | grep -oP '\d+\.\d+(\.\d+)?' | head -1)
        echo -e "${GREEN}[✓]${NC} $name ${YELLOW}($version)${NC}"
        return 0
    else
        echo -e "${RED}[✗]${NC} $name - NOT INSTALLED"
        return 1
    fi
}

# Check Go tool
check_go_tool() {
    local tool=$1
    local name=$2
    
    if [ -f "$HOME/go/bin/$tool" ]; then
        echo -e "${GREEN}[✓]${NC} $name ${YELLOW}(~/go/bin/$tool)${NC}"
        return 0
    elif command -v $tool &> /dev/null; then
        echo -e "${GREEN}[✓]${NC} $name"
        return 0
    else
        echo -e "${RED}[✗]${NC} $name - NOT INSTALLED"
        return 1
    fi
}

echo "1. Core Scanning Tools"
echo "----------------------"
check_tool "nmap" "Nmap"
check_tool "masscan" "Masscan" || echo "   (Optional - fast port scanner)"
echo ""

echo "2. Web Enumeration Tools"
echo "------------------------"
check_tool "nikto" "Nikto"
check_tool "nuclei" "Nuclei"
check_tool "gobuster" "Gobuster"
check_go_tool "ffuf" "ffuf"
check_tool "dirb" "dirb" || echo "   (Optional - directory bruteforcer)"
check_tool "wfuzz" "wfuzz" || echo "   (Optional - web fuzzer)"
echo ""

echo "3. Subdomain Discovery"
echo "----------------------"
check_go_tool "subfinder" "Subfinder"
check_go_tool "amass" "Amass"
check_tool "sublist3r" "Sublist3r" || echo "   (Optional - subdomain enumerator)"
echo ""

echo "4. Exploitation Frameworks"
echo "--------------------------"
check_tool "msfconsole" "Metasploit Framework"
check_tool "searchsploit" "SearchSploit" || echo "   (Optional - exploit database)"
echo ""

echo "5. Password Attacks"
echo "-------------------"
check_tool "hydra" "Hydra"
check_tool "john" "John the Ripper"
check_tool "hashcat" "Hashcat" || echo "   (Optional - GPU password cracker)"
echo ""

echo "6. SQL Injection"
echo "----------------"
check_tool "sqlmap" "SQLMap"
echo ""

echo "7. Listeners & Shells"
echo "---------------------"
check_tool "nc" "Netcat"
check_tool "socat" "Socat"
if command -v pwncat-cs &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} Pwncat-cs"
else
    echo -e "${RED}[✗]${NC} Pwncat-cs - NOT INSTALLED"
fi
echo ""

echo "8. Network Configuration"
echo "------------------------"
# Check if we can reach HTB network (10.10.10.0/23)
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "Local IP: $LOCAL_IP"

# Check for HTB VPN connection (look for 10.10.x.x IP)
HTB_IP=$(ip addr | grep -oP '10\.10\.\d+\.\d+' | head -1)
if [ -n "$HTB_IP" ]; then
    echo -e "${GREEN}[✓]${NC} HTB VPN Connected: $HTB_IP"
else
    echo -e "${YELLOW}[!]${NC} HTB VPN Not Connected (connect via OpenVPN on Windows)"
fi
echo ""

echo "9. Environment Setup"
echo "--------------------"
# Check Go bin in PATH
if echo $PATH | grep -q "$HOME/go/bin"; then
    echo -e "${GREEN}[✓]${NC} Go bin in PATH"
else
    echo -e "${YELLOW}[!]${NC} Go bin NOT in PATH (run: source ~/.bashrc)"
fi

# Check wordlists
if [ -d "/usr/share/wordlists" ]; then
    echo -e "${GREEN}[✓]${NC} Wordlists directory exists"
    if [ -f "/usr/share/wordlists/rockyou.txt" ]; then
        echo -e "${GREEN}[✓]${NC} rockyou.txt available"
    else
        echo -e "${YELLOW}[!]${NC} rockyou.txt not found (may need to extract)"
    fi
else
    echo -e "${YELLOW}[!]${NC} Wordlists directory not found"
fi
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "To install missing tools, run:"
echo "  ${SCRIPT_DIR}/install-pentest-tools.sh"
echo ""
echo "To setup listeners for demo, run:"
echo "  ${SCRIPT_DIR}/setup-listeners.sh pwncat 4444"
echo ""
echo "To connect to HTB:"
echo "  1. Open OpenVPN GUI on Windows (as Administrator)"
echo "  2. Connect to your HTB .ovpn file"
echo "  3. Verify connection: ping <htb-machine-ip>"
echo ""
